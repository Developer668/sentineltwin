#!/usr/bin/env bash
set -euo pipefail

stack_name=${STACK_NAME:-sentineltwin}
region=${AWS_REGION:-us-west-2}
build_frontend=${BUILD_FRONTEND:-true}

command -v aws >/dev/null 2>&1 || { echo "AWS CLI is required." >&2; exit 1; }

output_value() {
  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --region "$region" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" \
    --output text
}

web_bucket=$(output_value WebBucketName)
distribution_id=$(output_value WebDistributionId)
web_url=$(output_value WebUrl)
api_url=$(output_value ApiUrl)
auth_mode=$(output_value AuthMode)
cognito_domain=$(output_value CognitoDomain)
cognito_client_id=$(output_value CognitoUserPoolClientId)
cognito_redirect_uri=$(output_value CognitoCallbackUrl)
cognito_scopes=$(output_value CognitoScopes)

[[ -n "$web_bucket" && "$web_bucket" != "None" ]] || { echo "WebBucketName stack output not found." >&2; exit 1; }
[[ -n "$distribution_id" && "$distribution_id" != "None" ]] || { echo "WebDistributionId stack output not found." >&2; exit 1; }
[[ -n "$api_url" && "$api_url" != "None" ]] || { echo "ApiUrl stack output not found." >&2; exit 1; }

if [[ "$build_frontend" == "true" ]]; then
  command -v pnpm >/dev/null 2>&1 || { echo "pnpm is required when BUILD_FRONTEND=true." >&2; exit 1; }
  echo "Building the SPA from stack outputs; only public API/Cognito identifiers enter the bundle."
  if [[ "$auth_mode" == "cognito" ]]; then
    [[ -n "$cognito_domain" && "$cognito_domain" != "None" ]] || { echo "CognitoDomain output not found." >&2; exit 1; }
    [[ -n "$cognito_client_id" && "$cognito_client_id" != "None" ]] || { echo "CognitoUserPoolClientId output not found." >&2; exit 1; }
    [[ -n "$cognito_redirect_uri" && "$cognito_redirect_uri" != "None" ]] || { echo "CognitoCallbackUrl output not found." >&2; exit 1; }
    env \
      VITE_API_URL="$api_url" \
      VITE_COGNITO_DOMAIN="$cognito_domain" \
      VITE_COGNITO_CLIENT_ID="$cognito_client_id" \
      VITE_COGNITO_REDIRECT_URI="$cognito_redirect_uri" \
      VITE_COGNITO_SCOPES="$cognito_scopes" \
      pnpm --dir frontend build
  else
    env \
      -u VITE_COGNITO_DOMAIN \
      -u VITE_COGNITO_CLIENT_ID \
      -u VITE_COGNITO_REDIRECT_URI \
      -u VITE_COGNITO_SCOPES \
      VITE_API_URL="$api_url" \
      pnpm --dir frontend build
  fi
elif [[ "$build_frontend" != "false" ]]; then
  echo "BUILD_FRONTEND must be 'true' or 'false'." >&2
  exit 2
fi

[[ -f frontend/dist/index.html ]] || {
  echo "frontend/dist/index.html is missing. Keep BUILD_FRONTEND=true or build it explicitly." >&2
  exit 1
}

aws s3 sync frontend/dist "s3://$web_bucket" \
  --region "$region" \
  --cache-control "public,max-age=3600" \
  --only-show-errors
aws s3 cp frontend/dist/index.html "s3://$web_bucket/index.html" \
  --region "$region" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html; charset=utf-8" \
  --only-show-errors
aws cloudfront create-invalidation --distribution-id "$distribution_id" --paths '/*' >/dev/null

echo "Frontend uploaded without deleting retained S3 objects."
echo "Demo URL: $web_url"
echo "Redeploy with CORS_ORIGIN=$web_url so the loopback bootstrap origin is replaced."

#!/bin/zsh
# Rebuild the Option Remote map and publish it to the password-protected Vercel site.
#   tools/deploy-remote-map.sh            uses the Google times already saved in tools/google-cache.json
#   tools/deploy-remote-map.sh --google   also looks up any Google times that are missing first
# Change the shared password: edit MAP_PASSWORD in .env, then run
#   (cd deploy/moe-option-remote-map && vercel env rm MAP_PASSWORD production --yes && vercel env add MAP_PASSWORD production --sensitive) and redeploy.
set -e
cd "$(dirname "$0")/.."
python3 tools/build_remote_plan.py "$@" | tail -1
node tools/build-remote-map.mjs
node tools/build-deploy.mjs
cd deploy/moe-option-remote-map && npx --yes vercel@latest deploy --prod --yes

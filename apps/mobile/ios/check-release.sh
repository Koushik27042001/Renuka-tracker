#!/bin/sh
set -eu
case "${CONFIGURATION:-}" in
  *Debug*) exit 0 ;;
esac
if [ -n "${SRCROOT:-}" ]; then
  [ ! -f "$SRCROOT/.xcode.env" ] || . "$SRCROOT/.xcode.env"
  [ ! -f "$SRCROOT/.xcode.env.local" ] || . "$SRCROOT/.xcode.env.local"
fi
"${NODE_BINARY:-node}" -e '
const api = process.env.MOBILE_API_URL;
const version = process.env.MOBILE_APP_VERSION;
try {
  const url = new URL(api);
  if (url.protocol !== "https:" || url.origin !== api || url.username || url.password) throw Error();
  if (!/^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$/.test(version)) throw Error();
  if (process.env.MARKETING_VERSION !== version) throw Error();
} catch {
  console.error("Release requires an HTTPS MOBILE_API_URL and a MOBILE_APP_VERSION matching the Xcode marketing version.");
  process.exit(1);
}
'

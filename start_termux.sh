#!/data/data/com.termux/files/usr/bin/bash
# Run the Shadow Fighter server inside Termux.
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Installing nodejs..."; pkg update -y && pkg install -y nodejs; }
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock   # keep server alive with screen off
export PORT="${PORT:-3000}"
if [ -z "$ADMIN_KEY" ]; then
  [ -f .admin_key ] || head -c 9 /dev/urandom | od -An -tx1 | tr -d ' \n' > .admin_key
  export ADMIN_KEY="$(cat .admin_key)"
fi
IP=$(ip -4 addr show wlan0 2>/dev/null | grep -o 'inet [0-9.]*' | cut -d' ' -f2)
echo "======================================"
echo " Admin key  : $ADMIN_KEY"
echo " Admin page : http://127.0.0.1:$PORT/admin   (open in any browser)"
echo " Game server: http://127.0.0.1:$PORT"
[ -n "$IP" ] && echo " Wi-Fi      : http://$IP:$PORT  (admin: http://$IP:$PORT/admin)"
echo "======================================"
exec node server.js

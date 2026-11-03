#!/usr/bin/env bash
# Real ABDM SANDBOX run of "Log in with an ABHA number" through this prototype
# (VRFY_ABHA_101 by Aadhaar OTP, VRFY_ABHA_201 by the ABHA-linked mobile OTP).
# Needs the server running with ABDM_MODE=sandbox. You type the ABHA number and the OTP yourself; both
# are hidden, not echoed, not written to any file, and sent only to localhost:3000.
# To reuse a test child:  CHILD=<id> ./scripts/abha-login-run.sh
set -u
API=${API:-http://localhost:3000}
json() { python3 -c "import sys,json
d=json.load(sys.stdin)
for k in sys.argv[1:]:
    d=d.get(k) if isinstance(d,dict) else None
print('' if d is None else d)" "$@"; }

TOKEN=$(curl -s -X POST $API/auth/mock-login -H 'Content-Type: application/json' \
  -d '{"username":"neha.sharma","password":"mock-password-1"}' | json token)
[ -n "$TOKEN" ] || { echo "Login failed. Is the server running on $API?"; exit 1; }
AUTH=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

CHILD=${CHILD:-}
if [ -z "$CHILD" ]; then
  CHILD=$(curl -s -X POST $API/children "${AUTH[@]}" \
    -d '{"name":"Sandbox Login Test","dateOfBirth":"2024-03-15","guardianName":"Neha Sharma","state":"Maharashtra","consentStatus":"granted"}' | json id)
fi
echo "Test child: $CHILD"

echo
echo "Where should the OTP go?"
echo "  1) the phone linked to Aadhaar   (VRFY_ABHA_101)"
echo "  2) the phone linked to the ABHA  (VRFY_ABHA_201)"
read -r -p "Choose 1 or 2: " CHOICE
case "$CHOICE" in 1) METHOD=aadhaar;; 2) METHOD=mobile;; *) echo "Choose 1 or 2."; exit 1;; esac

read -r -s -p "ABHA number (14 digits, dashes optional, hidden): " ABHA; echo
RES=$(curl -s -X POST $API/abha/children/$CHILD/login/request-otp "${AUTH[@]}" \
  -d "{\"abhaNumber\":\"$ABHA\",\"method\":\"$METHOD\"}")
unset ABHA
echo "$RES"
TXN=$(echo "$RES" | json txnId)
[ -n "$TXN" ] || { echo "No txnId: stopping. Paste the line above to Claude. (details.abdmCode ABDM-1114 means nobody holds this ABHA.)"; exit 1; }

read -r -s -p "OTP from the phone (6 digits, hidden): " OTP; echo
RES=$(curl -s -X POST $API/abha/children/$CHILD/login/verify-otp "${AUTH[@]}" -d "{\"txnId\":\"$TXN\",\"otp\":\"$OTP\"}")
unset OTP
echo "$RES"
[ "$(echo "$RES" | json authResult)" = "success" ] || { echo "Verify did not succeed: stopping."; exit 1; }

echo; echo "--- profile"
curl -s "$API/abha/children/$CHILD/login/profile?txnId=$TXN" "${AUTH[@]}"; echo

echo; echo "--- card"
OUT=${TMPDIR:-/tmp}/abha-card-login.png
CODE=$(curl -s -o "$OUT" -w '%{http_code}' "$API/abha/children/$CHILD/login/card?txnId=$TXN" "${AUTH[@]}")
echo "card HTTP $CODE"; [ "$CODE" = "200" ] && echo "saved to $OUT" || cat "$OUT"
echo; echo "Done. The output above holds no Aadhaar number or OTP, but it does show names: mask what you paste."

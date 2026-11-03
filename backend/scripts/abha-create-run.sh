#!/usr/bin/env bash
# Real ABDM SANDBOX run of "Create ABHA by Aadhaar OTP" through this prototype.
# Needs: the server running with ABDM_MODE=sandbox (cd backend && npm run dev).
# You type the Aadhaar number and the OTP yourself. Both are hidden as you type, are not echoed, are
# not written to any file and are sent only to localhost:3000 (which encrypts them for ABDM).
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

# To resume a run whose OTP is still valid:  CHILD=<id> TXN=<txnId> ./scripts/abha-create-run.sh
CHILD=${CHILD:-}
TXN=${TXN:-}
if [ -z "$CHILD" ]; then
  CHILD=$(curl -s -X POST $API/children "${AUTH[@]}" \
    -d '{"name":"Sandbox Test","dateOfBirth":"2024-03-15","guardianName":"Neha Sharma","state":"Maharashtra","consentStatus":"granted"}' | json id)
fi
echo "Test child: $CHILD"

if [ -z "$TXN" ]; then
echo
  echo "Terms: the person must agree to the ABDM enrolment terms before the Aadhaar number is sent."
  read -r -p "Does the person agree? (yes/no): " AGREE
  [ "$AGREE" = "yes" ] || { echo "Stopped: no agreement."; exit 1; }
  
  read -r -s -p "Test Aadhaar number (12 digits, hidden): " AADHAAR; echo
  RES=$(curl -s -X POST $API/abha/children/$CHILD/create/request-otp "${AUTH[@]}" \
    -d "{\"aadhaar\":\"$AADHAAR\",\"consentAgreed\":true}")
  unset AADHAAR
  echo "$RES"
  TXN=$(echo "$RES" | json txnId)
  [ -n "$TXN" ] || { echo "No txnId: stopping. Paste the line above to Claude."; exit 1; }
  
fi
read -r -s -p "OTP from the phone (6 digits, hidden): " OTP; echo
read -r -s -p "Mobile number to link with the ABHA (10 digits, hidden; the Aadhaar-linked one needs no second OTP): " MOBILE; echo
RES=$(curl -s -X POST $API/abha/children/$CHILD/create/verify-otp "${AUTH[@]}" -d "{\"txnId\":\"$TXN\",\"otp\":\"$OTP\",\"mobile\":\"$MOBILE\"}")
unset OTP MOBILE
echo "$RES"
[ -n "$(echo "$RES" | json profile)" ] || { echo "Verify did not return a profile: stopping."; exit 1; }

echo; echo "--- address suggestions"
SUG=$(curl -s "$API/abha/children/$CHILD/create/address-suggestions?txnId=$TXN" "${AUTH[@]}")
echo "$SUG"
read -r -p "Type the address to create (without @sbx), or press Return to skip: " ADDR
if [ -n "$ADDR" ]; then
  curl -s -X POST $API/abha/children/$CHILD/create/address "${AUTH[@]}" -d "{\"txnId\":\"$TXN\",\"abhaAddress\":\"$ADDR\"}"; echo
fi

echo; echo "--- profile"
curl -s "$API/abha/children/$CHILD/create/profile?txnId=$TXN" "${AUTH[@]}"; echo

echo; echo "--- card"
OUT=${TMPDIR:-/tmp}/abha-card.png
CODE=$(curl -s -o "$OUT" -w '%{http_code}' "$API/abha/children/$CHILD/create/card?txnId=$TXN" "${AUTH[@]}")
echo "card HTTP $CODE"; [ "$CODE" = "200" ] && echo "saved to $OUT (open it to see the card)" || cat "$OUT"
echo; echo "Done. Paste the output above to Claude (it contains no Aadhaar or OTP)."

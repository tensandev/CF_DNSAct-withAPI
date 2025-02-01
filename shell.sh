curl --request PATCH \
  --url https://api.cloudflare.com/client/v4/zones/1092834790812374091234ojahsdfjhof/dns_records/iuhfiuh9843h9uhifre \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer uidqwhdiqwhdHUUIUH89039812" \
  --data '{
    "comment": "Domain verification record",
  "name": "blog",
  "proxied": false,
  "settings": {},
  "tags": [],
  "ttl": 3600,
  "content": "198.51.100.4",
  "type": "A"
  }'
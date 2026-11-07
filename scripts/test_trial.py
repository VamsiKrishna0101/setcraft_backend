import jwt
import urllib.request
import json

jwt_secret = ''
port = '8000'
for line in open('backend/.env', 'r', encoding='utf-8'):
    line = line.strip()
    if line.startswith('JWT_ACCESS_SECRET='):
        jwt_secret = line.split('=', 1)[1].strip().strip('"').strip("'")

uid = 'b905bac8-4c47-4fb5-b53b-9850d71231ea'
email = 'suiii9691@gmail.com'
token = jwt.encode({'userId': uid, 'email': email}, jwt_secret, algorithm='HS256')

req = urllib.request.Request(
    f'http://localhost:{port}/api/subscription/start-trial',
    data=b'{}',
    headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'Accept': 'application/json'},
    method='POST'
)
try:
    with urllib.request.urlopen(req) as resp:
        print('Trial success:', resp.read().decode())
except urllib.error.HTTPError as e:
    print('HTTPError:', e.code, e.read().decode())
except Exception as e:
    print('Error:', e)

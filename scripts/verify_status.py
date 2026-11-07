import psycopg2
import urllib.request
import json
import jwt

db_url = ''
rc_key = ''
jwt_secret = ''
port = '5000'

for line in open('backend/.env', 'r', encoding='utf-8'):
    line = line.strip()
    if line.startswith('DATABASE_URL='):
        db_url = line.split('=', 1)[1].strip().strip('"').strip("'")
    elif line.startswith('REVENUECAT_API_KEY='):
        rc_key = line.split('=', 1)[1].strip().strip('"').strip("'")
    elif line.startswith('JWT_ACCESS_SECRET='):
        jwt_secret = line.split('=', 1)[1].strip().strip('"').strip("'")
    elif line.startswith('PORT='):
        port = line.split('=', 1)[1].strip().strip('"').strip("'")

if '?schema=' in db_url:
    db_url = db_url.split('?')[0]

email = 'suiii9691@gmail.com'
conn = psycopg2.connect(db_url)
cur = conn.cursor()
cur.execute('SELECT id, email, "trialStartedAt", "trialEndsAt" FROM "User" WHERE email = %s', (email,))
user = cur.fetchone()

if user:
    uid = user[0]
    token = jwt.encode({'userId': uid, 'email': email}, jwt_secret, algorithm='HS256')
    
    # Query backend status
    try:
        req = urllib.request.Request(
            f'http://localhost:{port}/api/subscription/status?platform=ios',
            headers={'Authorization': f'Bearer {token}', 'Accept': 'application/json'}
        )
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            print('Backend subscription status:', json.dumps(data.get('data'), indent=2))
    except Exception as e:
        print('Backend status error:', e)

cur.close()
conn.close()

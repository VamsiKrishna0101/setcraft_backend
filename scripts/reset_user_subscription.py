import psycopg2
import urllib.request
import json

db_url = ''
rc_key = ''
for line in open('backend/.env', 'r', encoding='utf-8'):
    line = line.strip()
    if line.startswith('DATABASE_URL='):
        db_url = line.split('=', 1)[1].strip().strip('"').strip("'")
    elif line.startswith('REVENUECAT_API_KEY='):
        rc_key = line.split('=', 1)[1].strip().strip('"').strip("'")

if '?schema=' in db_url:
    db_url = db_url.split('?')[0]

email = 'suiii9691@gmail.com'
conn = psycopg2.connect(db_url)
cur = conn.cursor()
cur.execute('SELECT id, email, "trialStartedAt", "trialEndsAt" FROM "User" WHERE email = %s', (email,))
user = cur.fetchone()
print('User:', user)

if user:
    uid = user[0]
    
    # 1. Delete subscriber from RevenueCat
    if rc_key:
        try:
            req = urllib.request.Request(
                f'https://api.revenuecat.com/v1/subscribers/{uid}',
                headers={'Authorization': f'Bearer {rc_key}', 'Accept': 'application/json'},
                method='DELETE'
            )
            with urllib.request.urlopen(req) as resp:
                print('RevenueCat subscriber deleted. Status:', resp.status)
        except Exception as e:
            print('RevenueCat delete error:', e)

    # 2. Delete all records from Subscription table
    cur.execute('DELETE FROM "Subscription" WHERE "userId" = %s', (uid,))
    print('Deleted DB subscriptions count:', cur.rowcount)
    
    # 3. Expire the User trial date
    cur.execute('UPDATE "User" SET "trialStartedAt" = %s, "trialEndsAt" = %s WHERE id = %s', ('2020-01-01 00:00:00', '2020-01-15 00:00:00', uid))
    conn.commit()
    print('User trial expired set to 2020-01-15')

    # 4. Verify RevenueCat state
    if rc_key:
        try:
            req = urllib.request.Request(
                f'https://api.revenuecat.com/v1/subscribers/{uid}',
                headers={'Authorization': f'Bearer {rc_key}', 'Accept': 'application/json'}
            )
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
                entitlements = data.get('subscriber', {}).get('entitlements', {})
                print('RevenueCat entitlements after reset:', entitlements)
        except Exception as e:
            print('RevenueCat verify error:', e)

cur.close()
conn.close()
print('All subscription data successfully cleared for suiii9691@gmail.com!')

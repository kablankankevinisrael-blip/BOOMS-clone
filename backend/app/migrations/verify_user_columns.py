from app.database import SessionLocal
s = SessionLocal()
res = s.execute("SELECT column_name FROM information_schema.columns WHERE table_name='users'")
cols = {r[0] for r in res}
for name in ['status','status_reason','status_message','status_source','status_metadata','status_expires_at','last_status_changed_at','status_changed_by','suspended_until','suspension_count','last_suspension_at','banned_at','banned_by']:
    print(name, '✅' if name in cols else '❌')
s.close()

from app.database import SessionLocal

session = SessionLocal()
rows = session.execute(
    "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE pg_type.typname = 'userstatus'"
).fetchall()
print(rows)
session.close()

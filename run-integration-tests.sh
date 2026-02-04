#!/bin/bash
# BOOMS Admin Panel - Integration & Testing Script

echo "🚀 BOOMS Admin Integration Script"
echo "=================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. DATABASE SETUP
echo -e "${BLUE}[1/5]${NC} Preparing database migration..."
cd "$(dirname "$0")/backend"

if [ -d "alembic" ]; then
    echo "Running Alembic migrations..."
    alembic upgrade head
    echo -e "${GREEN}✅ Database migration completed${NC}"
else
    echo -e "${YELLOW}⚠️ Alembic not configured${NC}"
fi

echo ""

# 2. BACKEND START
echo -e "${BLUE}[2/5]${NC} Starting backend server..."
echo "Command: cd backend && python -m uvicorn app.main:app --reload"
echo ""
read -p "Start backend in new terminal? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd backend
    python -m uvicorn app.main:app --reload &
    BACKEND_PID=$!
    echo -e "${GREEN}✅ Backend started (PID: $BACKEND_PID)${NC}"
    echo "   URL: http://localhost:8000"
fi

echo ""

# 3. FRONTEND START
echo -e "${BLUE}[3/5]${NC} Starting frontend development server..."
cd "$(dirname "$0")/admin-web"
echo "Command: cd admin-web && npm run dev"
echo ""
read -p "Start frontend in new terminal? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm run dev &
    FRONTEND_PID=$!
    echo -e "${GREEN}✅ Frontend started (PID: $FRONTEND_PID)${NC}"
    echo "   URL: http://localhost:3000"
fi

echo ""

# 4. TESTING CHECKLIST
echo -e "${BLUE}[4/5]${NC} Testing Checklist"
echo "=================================="
cat << 'EOF'

Frontend Pages (http://localhost:3000/admin/):
  [ ] Treasury (/treasury)
      - Can you see 💰 Solde Principal?
      - Can you click "💰 Déposer des fonds"?
      - Can you fill form and submit deposit?
      - Can you withdraw?
      
  [ ] Funds (/funds)
      - Can you see commissions and user funds tabs?
      - Can you click on a user and see details?
      - Can you open redistribution modal?
      
  [ ] Transactions (/transactions)
      - Can you see wallet and payment tabs?
      - Can you filter transactions?
      - Can you click on a transaction for details?
      
  [ ] Analytics (/analytics)
      - Can you see main stats?
      - Can you change time range?
      - Can you see top 10 users?
      
  [ ] BOMs (/boms)
      - Can you see list of BOMs?
      - Can you create new BOM?
      - Can you transfer ownership?
      
  [ ] Users (/users)
      - Can you see user list?
      - Can you toggle user status?
      - Can you ban a user?
      
  [ ] Gifts (/gifts)
      - Can you see gifts list? (NEW)
      - Can you filter by status?
      
  [ ] Settings (/settings)
      - Can you change platform name? (NEW)
      - Can you update fees? (NEW)
      - Can you change security settings? (NEW)

API Endpoints (http://localhost:8000/docs):
  [ ] GET /admin/gifts - Returns gift list
  [ ] GET /admin/settings - Returns platform settings
  [ ] PUT /admin/settings/general - Updates general settings
  [ ] PUT /admin/settings/fees - Updates fee settings
  [ ] PUT /admin/settings/payment - Updates payment settings
  [ ] PUT /admin/settings/notifications - Updates notifications
  [ ] PUT /admin/settings/security - Updates security settings
  
  [ ] POST /admin/treasury/deposit - Creates deposit
  [ ] POST /admin/treasury/withdraw - Creates withdrawal
  [ ] POST /admin/redistribute - Redistributes funds

EOF

echo ""

# 5. CLEANUP
echo -e "${BLUE}[5/5]${NC} Cleanup (optional)"
echo "=================================="
echo ""
read -p "Kill backend and frontend processes? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    echo -e "${GREEN}✅ Processes terminated${NC}"
fi

echo ""
echo -e "${GREEN}✅ Integration setup complete!${NC}"
echo ""
echo "📖 Documentation: see INTEGRATION_COMPLETION_REPORT.md"

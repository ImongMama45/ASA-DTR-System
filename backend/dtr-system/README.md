# DTR Admin System
## Daily Time Record — Civil Service Form No. 48

A full-stack, offline-first Progressive Web App for generating, managing, and exporting Daily Time Records (DTRs) for Philippine civil service employees.

---

## 🏗 Architecture

```
dtr-system/
├── frontend/          ← React + Vite PWA (deploy to Netlify)
│   ├── src/
│   │   ├── App.jsx              Main app shell + navigation
│   │   ├── App.css              All styles
│   │   ├── main.jsx             Entry point
│   │   ├── db/index.js          IndexedDB layer (offline storage)
│   │   ├── hooks/useSync.js     Online/offline sync hook
│   │   ├── utils/
│   │   │   ├── dateUtils.js     Week detection, time generation
│   │   │   └── exportDocx.js    .docx export (3-strip layout)
│   │   ├── components/
│   │   │   └── DTRStrip.jsx     Single DTR strip (exact template)
│   │   └── pages/
│   │       ├── Dashboard.jsx    Stats + history
│   │       ├── Employees.jsx    CRUD + searchable dropdown
│   │       ├── Generator.jsx    3-step DTR wizard
│   │       └── Review.jsx       Preview + export
│   ├── public/
│   │   ├── sw.js                Service Worker (PWA/offline)
│   │   └── manifest.json        PWA manifest
│   ├── netlify.toml             Netlify deploy config
│   └── package.json
│
└── backend/           ← Django REST API (deploy to Render)
    ├── dtr_api/
    │   ├── models.py    Employee, DTRBatch, SyncLog
    │   ├── views.py     REST endpoints + sync handler
    │   ├── serializers.py
    │   ├── urls.py
    │   └── admin.py
    ├── dtr_project/
    │   ├── settings.py  SQLite (dev) + PostgreSQL (prod)
    │   ├── urls.py
    │   └── wsgi.py
    ├── manage.py
    ├── requirements.txt
    ├── Procfile
    └── render.yaml
```

---

## 🚀 Quick Start (Local Development)

### Backend (Django)

```bash
cd dtr-system/backend

# Create virtual environment
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run migrations
python manage.py migrate

# Create admin superuser
python manage.py createsuperuser

# Start server (runs on http://localhost:8000)
python manage.py runserver
```

### Frontend (React)

```bash
cd dtr-system/frontend

# Install dependencies
npm install

# Start dev server (runs on http://localhost:5173)
npm run dev
```

Open http://localhost:5173 in your browser.

---

## 🌐 Production Deployment

### Backend → Render.com

1. Push `backend/` folder to a GitHub repository
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` — click **Apply**
5. Note your backend URL: `https://dtr-backend.onrender.com`

### Frontend → Netlify

1. Push `frontend/` folder to GitHub
2. Go to [netlify.com](https://netlify.com) → New Site from Git
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Set environment variable:
   ```
   VITE_API_URL = https://dtr-backend.onrender.com/api
   ```
6. Deploy — Netlify detects `netlify.toml` automatically

---

## 📱 PWA Installation

After deploying to Netlify:
- **Android**: Open in Chrome → "Add to Home Screen" prompt appears
- **iOS Safari**: Tap Share → "Add to Home Screen"
- **Desktop Chrome**: Click install icon in address bar

---

## ✨ Features

### Offline-First
- All data (employees, DTR batches) stored in **IndexedDB** locally
- Full functionality **without internet**
- When internet restores, sync queue auto-processes to Django backend
- Dashboard stats load from server only when online

### Employee Management
- Add/Edit/Delete employees
- **Searchable dropdown** — type to filter, auto-suggest
- Fields: Full Name (ALL CAPS), Duty Type (AM/PM), Start Date

### DTR Generator (3-Step Wizard)
1. **Period Setup** — select Month, Year, Cutoff (1–15 or 16–31)
2. **Weekly Hours** — auto-detected Mon→Sun weeks, set hours per week
3. **Attendance Input** — click-to-toggle Present/Absent per employee per day

### Week Detection (Monday → Sunday)
- Dates are automatically grouped into Mon–Sun weeks
- Working hours set per week distribute evenly across workdays
- AM duty: arrival 7:xx–8:00, departure calculated by hours
- PM duty: arrival 1:xx–2:00, departure calculated by hours

### Template (Exact Replication)
- Civil Service Form No. 48
- Exact layout: header, name underline, month line, official hours, time table
- Weekends auto-filled: SAT / SUN
- Certification text, employee signature, verifier (ALYSSA MARIE L. MIJARES)

### 3-Strip Side-by-Side Layout ✅
- Each employee rendered **THREE times** side by side
- Matches the original template exactly
- Preview on screen + export to .docx

### Export to Word (.docx)
- One file for entire batch
- Each employee = exactly **one page**
- Three strips side-by-side per page
- Short bond paper (8.5 × 11 inches)
- Generated using `docx` library

---

## 🔌 API Endpoints

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/employees/` | List all employees |
| POST | `/api/employees/` | Create employee |
| PUT | `/api/employees/{id}/` | Update employee |
| DELETE | `/api/employees/{id}/` | Delete employee |
| GET | `/api/batches/` | List DTR batches |
| POST | `/api/batches/` | Create batch |
| PUT | `/api/batches/{id}/` | Update batch |
| POST | `/api/sync/` | Process sync queue item |
| GET | `/api/dashboard/` | Dashboard statistics |

Django Admin: `/admin/` (requires superuser)

---

## ⚙ Environment Variables

### Frontend (`.env`)
```
VITE_API_URL=http://localhost:8000/api
```

### Backend
```
DJANGO_SECRET_KEY=your-secret-key-here
DEBUG=False
DATABASE_URL=postgresql://user:pass@host/dbname
```

---

## 📋 DTR Template Notes

The export replicates **Civil Service Form No. 48** exactly:
- Page: 8.5" × 11" (short bond)
- Margins: 0.3" all sides
- Three identical strips per page, side by side
- Each strip contains complete DTR for one employee
- Time columns: AM Arrival, AM Departure, PM Arrival, PM Departure, Undertime Hours, Undertime Minutes
- Weekend rows auto-filled with SAT/SUN
- Total row at bottom
- Certification paragraph (italic)
- Employee name signature line
- "VERIFIED as to the prescribed office hours" + ALYSSA MARIE L. MIJARES

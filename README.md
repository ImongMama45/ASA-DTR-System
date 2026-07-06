# ASA DTR System

This is the repository for the Alliance of Student Assistance (ASA) DTR and Fund Tracking System.

## Project Structure
- `/backend`: Django REST Framework backend API.
- `/frontend`: React + Vite frontend application.

## ⚠️ Important Note Before Sharing
This repository has been configured to **safely exclude** sensitive information:
- The local SQLite database (`db.sqlite3`) is ignored.
- Environment variable files (`.env`) are ignored.
- Google Sheets API credentials JSON files are ignored.

## How to Run Locally

### 1. Backend Setup
1. Open a terminal and navigate to the `backend` folder:
   ```bash
   cd backend
   ```
2. Create and activate a Python virtual environment:
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On Mac/Linux:
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Copy the environment variables example:
   ```bash
   cp .env.example .env
   ```
5. Run migrations to create your local database:
   ```bash
   python manage.py migrate
   ```
6. Start the development server:
   ```bash
   python manage.py runserver
   ```
   *The backend will run on `http://localhost:8000`.*

### 2. Frontend Setup
1. Open a **new** terminal window and navigate to the `frontend` folder:
   ```bash
   cd frontend
   ```
2. Install Node.js dependencies:
   ```bash
   npm install
   ```
3. Copy the environment variables example:
   ```bash
   cp .env.example .env
   ```
4. Start the frontend development server:
   ```bash
   npm run dev
   ```
   *The frontend will run on `http://localhost:5173`.*

### 3. Setting up Google Sheets Sync (Optional)
If you need to test the Google Sheets syncing feature locally:
1. Obtain a Google Service Account credentials JSON file.
2. Place it in the root or backend folder (e.g., `dtr-sheets-sync.json`).
3. Update the `GOOGLE_SHEETS_CREDENTIALS_PATH` in your `backend/.env` file to point to this JSON file.

### 4. Creating a SuperAdmin Account
To access the system, you will need a SuperAdmin account.
Run the following custom command in the `backend` terminal:
```bash
python manage.py create_superadmin --username admin --password yourpassword123
```
You can then use this account to log in to the frontend.

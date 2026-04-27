import { openDB } from 'idb';

const DB_NAME = 'dtr-system';
const DB_VERSION = 1;

export const initDB = () =>
  openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('employees')) {
        const empStore = db.createObjectStore('employees', { keyPath: 'id', autoIncrement: true });
        empStore.createIndex('name', 'name');
      }
      if (!db.objectStoreNames.contains('batches')) {
        const batchStore = db.createObjectStore('batches', { keyPath: 'id', autoIncrement: true });
        batchStore.createIndex('label', 'label');
      }
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
      }
    },
  });

// ---- Employees ----
export async function getAllEmployees() {
  const db = await initDB();
  return db.getAll('employees');
}
export async function addEmployee(emp) {
  const db = await initDB();
  const id = await db.add('employees', { ...emp, synced: false, createdAt: Date.now() });
  await addToSyncQueue({ action: 'CREATE_EMPLOYEE', payload: { ...emp, localId: id } });
  return id;
}
export async function updateEmployee(emp) {
  const db = await initDB();
  await db.put('employees', { ...emp, synced: false });
  await addToSyncQueue({ action: 'UPDATE_EMPLOYEE', payload: emp });
}
export async function deleteEmployee(id) {
  const db = await initDB();
  await db.delete('employees', id);
  await addToSyncQueue({ action: 'DELETE_EMPLOYEE', payload: { id } });
}

// ---- Batches ----
export async function getAllBatches() {
  const db = await initDB();
  return db.getAll('batches');
}
export async function getBatch(id) {
  const db = await initDB();
  return db.get('batches', id);
}
export async function saveBatch(batch) {
  const db = await initDB();
  const id = await db.add('batches', { ...batch, synced: false, createdAt: Date.now() });
  await addToSyncQueue({ action: 'CREATE_BATCH', payload: { ...batch, localId: id } });
  return id;
}
export async function updateBatch(batch) {
  const db = await initDB();
  await db.put('batches', { ...batch, synced: false });
  await addToSyncQueue({ action: 'UPDATE_BATCH', payload: batch });
}

// ---- Sync Queue ----
export async function addToSyncQueue(item) {
  const db = await initDB();
  await db.add('syncQueue', { ...item, createdAt: Date.now() });
}
export async function getSyncQueue() {
  const db = await initDB();
  return db.getAll('syncQueue');
}
export async function clearSyncItem(id) {
  const db = await initDB();
  await db.delete('syncQueue', id);
}

import { openDB } from 'idb';

const DB_NAME = 'fra-offline-db';
const DB_VERSION = 1;
const STORE_NAME = 'claims';

export const initDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    },
  });
};

export const saveOfflineClaim = async (claimData) => {
  try {
    const db = await initDB();
    const id = await db.add(STORE_NAME, {
      ...claimData,
      createdAt: new Date().toISOString(),
      syncStatus: 'pending'
    });
    return id;
  } catch (error) {
    console.error('Failed to save claim offline', error);
    throw error;
  }
};

export const getOfflineClaims = async () => {
  try {
    const db = await initDB();
    return await db.getAll(STORE_NAME);
  } catch (error) {
    console.error('Failed to get offline claims', error);
    return [];
  }
};

export const deleteOfflineClaim = async (id) => {
  try {
    const db = await initDB();
    await db.delete(STORE_NAME, id);
  } catch (error) {
    console.error(`Failed to delete offline claim ${id}`, error);
  }
};

// We receive dispatch as an argument to trigger the redux store action
export const syncOfflineClaims = async (dispatch, submitAction) => {
  if (!navigator.onLine) return;

  const claims = await getOfflineClaims();
  if (!claims || claims.length === 0) return;

  console.log(`Starting sync for ${claims.length} offline claims...`);

  for (const claim of claims) {
    try {
      // Re-construct formData or payload for thunk
      const payload = {
        claimantName: claim.claimantName,
        village: claim.village,
        state: claim.state,
        district: claim.district,
        polygon: claim.polygon,
        files: claim.files, // Files stored natively in IDB
      };
      
      // Dispatch the redux thunk
      await dispatch(submitAction(payload)).unwrap();
      
      // On success, remove from offline DB
      await deleteOfflineClaim(claim.id);
      console.log(`Successfully synced claim ${claim.id}`);
    } catch (error) {
      console.error(`Failed to sync claim ${claim.id}`, error);
      // It will remain in IDB and retry on next sync
    }
  }
};

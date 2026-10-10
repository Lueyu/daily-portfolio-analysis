/**
 * @file hooks/use-example.ts
 * @brief Example hook kept as a reference template.
 *
 * This file is intentionally commented out. It demonstrates the standard
 * shape for a data-fetching hook: local state ({ data, loading, error }),
 * a `useEffect` that triggers the fetch on mount, and a returned `refetch`
 * callback. Copy this file and adapt it when building a new hook.
 */

// import { useState, useEffect } from 'react';
// import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
// import { logger } from '@lark-apaas/client-toolkit/logger';

// interface RecordData {
//   title?: string,
//   type?: string,
//   creator?: string,
//   speakDate?: string,
// record: any;
// loading: boolean;
// error?: string;
// }

// export function useRecordData() {
//   const [data, setData] = useState<RecordData>({
//     record: {},
//     loading: true,
//     error: null,
//   });

//   useEffect(() => {
//     fetchRecordData();
//   }, []);

//   const fetchRecordData = async () => {
//     try {
//       setData(prev => ({ ...prev, loading: true, error: null }));

//       // Use the shared axios instance to call the backend.
//       const response = await axiosForBackend.get('/api/hello');

//       // Extract the payload field from the response envelope.
//       const record = response.data.data;

//       setData({
//         record,
//         loading: false,
//         error: null,
//       });
//     } catch (error) {
//       logger.error('Failed to load record', error);
//       setData(prev => ({
//         ...prev,
//         loading: false,
//         error: 'Failed to load record, please retry later',
//       }));
//     }
//   };

//   return { ...data, refetch: fetchRecordData };
// }

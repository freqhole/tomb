// blob storage - re-exported from the shared freqhole-api-client/storage package.
// spume's debug logger is wired in at module load.

import { debug } from "../../../utils/logger";
import { setStorageLogger } from "freqhole-api-client/storage";

// wire spume's debug logger into the shared storage module
setStorageLogger(debug);

export {
  BLOB_DB_NAME,
  type BlobStorageType,
  type BlobRecord,
  storeBlob,
  getBlobMetadata,
  getBlob,
  getBlobObjectURL,
  getCachedBlobObjectURL,
  clearBlobUrlCache,
  deleteBlob,
  closeBlobDB,
} from "freqhole-api-client/storage";

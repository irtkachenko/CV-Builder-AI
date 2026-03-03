import multer from "multer";
import { appConfig } from "../config/app-config";

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: appConfig.file.maxFileSizeBytes,
  },
  fileFilter: (req, file, cb) => {
    // Accept only .docx files
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      cb(null, true);
    } else {
      cb(new Error('Only .docx files are allowed'));
    }
  }
});

import { Router } from "express";
import { authenticateStrict as authenticate } from "../../middleware/auth";
import {
  handleProcessScan,
  handleGetHistory,
  handleGetLatestScan,
  handleGetScanById,
  handleCaptureScan,
  handleGetJobStatus,
} from "./bodyscan_controller";

const router = Router();

// Retired writers return 410. Historical records remain available below.
router.post("/process", authenticate, handleProcessScan);

router.post("/capture", authenticate, handleCaptureScan);

// Retired asynchronous jobs also return 410.
router.get("/job/:jobId", authenticate, handleGetJobStatus);

// Get past scan records
router.get("/history", authenticate, handleGetHistory);

// Get latest active body scan
router.get("/latest", authenticate, handleGetLatestScan);

// Get specific scan by ID  (must be last to avoid matching /job/:jobId)
router.get("/:id", authenticate, handleGetScanById);

export default router;

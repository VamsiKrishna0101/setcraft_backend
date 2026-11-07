import { Router } from "express";
import { authenticateStrict, requireRole } from "../../middleware/auth";
import sessionRoutes from './session/session_routes';
import { requirePremium } from '../subscription/subscription_service';
import {
    handleCreateExercise,
    handleGetAllExercises,
    handleGetExerciseById,
    handleUpdateExercise,
    handleDeleteExercise,
    handleGetUserWorkouts,
    handleMarkItemComplete,
    handleMarkItemSkip,
    handleUpdateWorkoutItem,
    handleAddWorkoutItem,
    handleDeleteWorkoutItem,
    handleMarkWorkoutComplete,
    handleLogSet,
    handleGetPreviousSets,
} from "./workout_controller";

const router = Router();

// ─── All workout routes require a valid JWT ───────────────────────────────────
router.use(authenticateStrict);
router.use('/training', sessionRoutes);
router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'DELETE' && req.user?.role !== 'ADMIN') {
    return void requirePremium(req, res, next);
  }
  next();
});

// ─── Public (any authenticated user) ─────────────────────────────────────────
router.get("/exercises", handleGetAllExercises);
router.get("/exercises/:id", handleGetExerciseById);

// ─── Admin only ───────────────────────────────────────────────────────────────
router.post("/exercises", requireRole("ADMIN"), handleCreateExercise);
router.patch("/exercises/:id", requireRole("ADMIN"), handleUpdateExercise);
router.delete("/exercises/:id", requireRole("ADMIN"), handleDeleteExercise);
// ─── User workouts ────────────────────────────────────────────────────────────
router.get("/me/:day", handleGetUserWorkouts);
router.patch("/item/:itemId/complete", handleMarkItemComplete);
router.patch("/item/:itemId/skip", handleMarkItemSkip);
router.patch("/item/:itemId", handleUpdateWorkoutItem);
router.post("/item", handleAddWorkoutItem);
router.delete("/item/:itemId", handleDeleteWorkoutItem);
router.patch("/:workoutId/complete", handleMarkWorkoutComplete);
router.post("/log-set", handleLogSet);
router.get("/previous-sets", handleGetPreviousSets);

export default router;

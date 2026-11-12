import { Request, Response } from "express";
import { z } from "zod";
import prisma from "../../config/prisma";
import { handleSubscription } from "./subscription_controller";

// Default known creators with their configured parameters
export const DEFAULT_CREATORS: Record<
  string,
  { name: string; discountPct: number; appleOfferId: string; revShare: number }
> = {
  ALEX20: {
    name: "Alex",
    discountPct: 20,
    appleOfferId: "CREATOR_20_OFF",
    revShare: 0.5,
  },
  MARC20: {
    name: "Marc",
    discountPct: 20,
    appleOfferId: "CREATOR_20_OFF",
    revShare: 0.5,
  },
  SWISSFIT: {
    name: "SwissFit",
    discountPct: 20,
    appleOfferId: "CREATOR_20_OFF",
    revShare: 0.5,
  },
  COACH20: {
    name: "Coach Partner",
    discountPct: 20,
    appleOfferId: "CREATOR_20_OFF",
    revShare: 0.5,
  },
};

export const validateCreatorCode = handleSubscription(
  async (req: Request, res: Response) => {
    const schema = z.object({ code: z.string().min(2).max(50) });
    const { code } = schema.parse(req.body);
    const normalized = code.trim().toUpperCase();

    // 1. Check database for existing Coupon
    let coupon = await prisma.coupon.findUnique({
      where: { code: normalized },
    });

    // 2. If not yet in DB but matches a known creator preset, auto-seed into DB
    if (!coupon && DEFAULT_CREATORS[normalized]) {
      const preset = DEFAULT_CREATORS[normalized];
      coupon = await prisma.coupon.create({
        data: {
          code: normalized,
          discountType: "PERCENTAGE",
          percentOff: preset.discountPct,
          isActive: true,
        },
      });
    }

    if (!coupon || !coupon.isActive) {
      res.status(404).json({
        valid: false,
        error: "Invalid or expired creator code",
      });
      return;
    }

    if (coupon.validUntil && coupon.validUntil < new Date()) {
      res.status(400).json({
        valid: false,
        error: "This creator code has expired",
      });
      return;
    }

    if (
      coupon.maxRedemptions &&
      coupon.timesRedeemed >= coupon.maxRedemptions
    ) {
      res.status(400).json({
        valid: false,
        error: "This creator code has reached its maximum redemptions",
      });
      return;
    }

    const preset = DEFAULT_CREATORS[normalized];
    const creatorName = preset?.name || normalized;
    const discountPct = coupon.percentOff || 20;

    res.json({
      valid: true,
      code: normalized,
      creatorName,
      discountPercent: discountPct,
      appleOfferId: preset?.appleOfferId || "CREATOR_20_OFF",
      message: `${discountPct}% creator discount with ${creatorName} applied`,
    });
  },
);

export const applyCreatorCode = handleSubscription(
  async (req: Request, res: Response) => {
    const schema = z.object({ code: z.string().min(2).max(50) });
    const { code } = schema.parse(req.body);
    const normalized = code.trim().toUpperCase();
    const userId = req.user!.userId;

    let coupon = await prisma.coupon.findUnique({
      where: { code: normalized },
    });

    if (!coupon && DEFAULT_CREATORS[normalized]) {
      const preset = DEFAULT_CREATORS[normalized];
      coupon = await prisma.coupon.create({
        data: {
          code: normalized,
          discountType: "PERCENTAGE",
          percentOff: preset.discountPct,
          isActive: true,
        },
      });
    }

    if (!coupon || !coupon.isActive) {
      res.status(404).json({ error: "Invalid creator code" });
      return;
    }

    // Record or update user redemption attribution
    await prisma.couponRedemption.upsert({
      where: {
        couponId_userId: {
          couponId: coupon.id,
          userId,
        },
      },
      create: {
        couponId: coupon.id,
        userId,
        discountAmount: 0,
      },
      update: {
        redeemedAt: new Date(),
      },
    });

    res.json({
      success: true,
      code: normalized,
      message: "Creator code successfully applied to account",
    });
  },
);

export const getCreatorReport = handleSubscription(
  async (_req: Request, res: Response) => {
    const coupons = await prisma.coupon.findMany({
      include: {
        redemptions: {
          include: {
            user: {
              select: { id: true, email: true, createdAt: true },
            },
          },
        },
      },
    });

    const report = coupons.map((c) => {
      const preset = DEFAULT_CREATORS[c.code];
      const totalUsers = c.redemptions.length;
      // Unit economics: 20% off annual plan (~63.99 EUR)
      // Minus Apple 15% (~9.60 EUR) = ~54.39 EUR net profit
      // 50% split = ~27.20 EUR to creator, ~27.20 EUR to Setcraft
      const revShareRate = preset?.revShare || 0.5;
      const estGrossPerSub = 63.99;
      const estAppleFeePerSub = estGrossPerSub * 0.15;
      const estNetPerSub = estGrossPerSub - estAppleFeePerSub;
      const estCreatorPerSub = estNetPerSub * revShareRate;

      return {
        code: c.code,
        creatorName: preset?.name || c.code,
        discountPercent: c.percentOff || 20,
        appleOfferId: preset?.appleOfferId || "CREATOR_20_OFF",
        revenueSharePercent: +(revShareRate * 100).toFixed(0),
        registeredUsersCount: totalUsers,
        estimatedGrossRevenue: +(totalUsers * estGrossPerSub).toFixed(2),
        estimatedAppleFees: +(totalUsers * estAppleFeePerSub).toFixed(2),
        estimatedNetProfit: +(totalUsers * estNetPerSub).toFixed(2),
        influencerOwedEarnings: +(totalUsers * estCreatorPerSub).toFixed(2),
        developerRetainedProfit: +(totalUsers * estCreatorPerSub).toFixed(2),
      };
    });

    res.json({ data: report });
  },
);

export async function linkCreatorPurchase(userId: string, code: string) {
  try {
    const normalized = code.trim().toUpperCase();
    const coupon = await prisma.coupon.findUnique({
      where: { code: normalized },
    });
    if (!coupon) return;

    await prisma.coupon.update({
      where: { id: coupon.id },
      data: { timesRedeemed: { increment: 1 } },
    });

    await prisma.couponRedemption.upsert({
      where: {
        couponId_userId: {
          couponId: coupon.id,
          userId,
        },
      },
      create: {
        couponId: coupon.id,
        userId,
        discountAmount: 0,
      },
      update: {
        redeemedAt: new Date(),
      },
    });
  } catch (err) {
    console.warn("Could not link creator purchase:", err);
  }
}

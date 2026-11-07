import prisma from "../../config/prisma";

export async function getScanHistory(userId: string) {
  return prisma.bodyScan.findMany({
    where: { userId },
    orderBy: { scanDate: "desc" },
    select: {
      id: true,
      scanDate: true,
      scanSource: true,
      heightCm: true,
      viewsUsed: true,
      chestCircumference: true,
      waistCircumference: true,
      hipCircumference: true,
      bicepLeftCircumference: true,
      bicepRightCircumference: true,
      thighLeftCircumference: true,
      thighRightCircumference: true,
      shoulderWidth: true,
      overallSymmetryScore: true,
      vTaperRatio: true,
      laggingMuscles: true,
      strongMuscles: true,
      fullModelGlbUrl: true,
      heatmapGlbUrl: true,
      deltaGlbUrl: true,
      scanAnalysis: true,
    },
  });
}

export async function getScanById(userId: string, scanId: string) {
  return prisma.bodyScan.findFirst({ where: { id: scanId, userId } });
}

export async function getLatestScan(userId: string) {
  return prisma.bodyScan.findFirst({ where: { userId }, orderBy: { scanDate: "desc" } });
}

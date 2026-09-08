import { prisma } from "@/server/db";

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function imageUrls(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const payloads = Array.isArray(record.responses) ? record.responses : [record];
  return payloads.flatMap((payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
    const data = (payload as Record<string, unknown>).data;
    if (!Array.isArray(data)) return [];
    return data.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const url = (item as Record<string, unknown>).url;
      return typeof url === "string" && url.startsWith("https://") ? [url] : [];
    });
  });
}

async function main() {
  const turns = await prisma.imageTurn.findMany({
    select: { params: true, outputAssetIds: true, providerResponse: true },
  });
  let updated = 0;

  for (const turn of turns) {
    if (!turn.params || typeof turn.params !== "object" || Array.isArray(turn.params)) continue;
    const model = (turn.params as Record<string, unknown>).model;
    if (typeof model !== "string") continue;
    const provider = model.toLowerCase().startsWith("agnes")
      ? "agnes"
      : model.toLowerCase().startsWith("gpt")
        ? "openai"
        : null;
    if (!provider) continue;

    const assetIds = stringArray(turn.outputAssetIds);
    const urls = provider === "agnes" ? imageUrls(turn.providerResponse) : [];
    for (const [index, assetId] of assetIds.entries()) {
      await prisma.asset.updateMany({
        where: { id: assetId, kind: "IMAGE_OUTPUT" },
        data: {
          provider,
          model,
          ...(urls[index] ? { remoteUrl: urls[index] } : {}),
        },
      });
      updated += 1;
    }
  }

  process.stdout.write(`Backfilled ${updated} image assets.\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

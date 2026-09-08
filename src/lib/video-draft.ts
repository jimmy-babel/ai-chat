import type { VideoMode } from "@/lib/config";

export type VideoReferenceState = {
  referenceImageAssetIds: string[];
  firstFrameAssetId?: string;
  lastFrameAssetId?: string;
  referenceVideoAssetId?: string;
};

export function referencesForVideoMode(
  mode: VideoMode,
  references: VideoReferenceState,
): VideoReferenceState {
  if (mode === "keyframe") {
    return {
      referenceImageAssetIds: [],
      firstFrameAssetId: references.firstFrameAssetId,
      lastFrameAssetId: references.lastFrameAssetId,
    };
  }

  if (mode === "reference") {
    return {
      referenceImageAssetIds: references.referenceImageAssetIds,
      referenceVideoAssetId: references.referenceVideoAssetId,
    };
  }

  return { referenceImageAssetIds: [] };
}

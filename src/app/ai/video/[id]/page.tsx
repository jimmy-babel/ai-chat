import { VideoStudio } from "@/components/video-studio/video-studio";
import { getPublicModels } from "@/server/model-catalog";

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VideoStudio id={id} models={getPublicModels("video")} />;
}

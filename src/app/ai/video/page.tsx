import { VideoStudio } from "@/components/video-studio/video-studio";
import { getPublicModels } from "@/server/model-catalog";

export default function VideoPage() {
  return <VideoStudio models={getPublicModels("video")} />;
}

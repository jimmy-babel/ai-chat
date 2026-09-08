import { ImageStudio } from "@/components/image-studio/image-studio";
import { getPublicModels } from "@/server/model-catalog";

export default function ImagePage() {
  return <ImageStudio models={getPublicModels("image")} />;
}

import { ImageStudio } from "@/components/image-studio/image-studio";
import { getPublicModels } from "@/server/model-catalog";

export default async function ImageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ImageStudio id={id} models={getPublicModels("image")} />;
}

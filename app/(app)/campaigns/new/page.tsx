import { requireUser } from "@/lib/auth-server";
import { CampaignWizard } from "./wizard";

export default async function NewCampaignPage() {
  await requireUser();
  return <CampaignWizard />;
}

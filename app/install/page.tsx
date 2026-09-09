import type { Metadata } from "next";
import InstallGuide from "@/components/InstallGuide";

export const metadata: Metadata = {
  title: "ثبّت رحلتي على آيفونك",
  description: "حمّل تطبيق رحلتي على الشاشة الرئيسية — بدون آب ستور.",
};

export default function Page() {
  return <InstallGuide />;
}

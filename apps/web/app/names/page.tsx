import type { Metadata } from "next";
import { EtymologyLab } from "./lab";
import { labCorpus } from "@/lib/etymology/lab-server";

export const metadata: Metadata = {
  title: "Etymology lab — Etymalia",
  description:
    "A focused etymology name generator: root words as rows, language eras as columns. Select the etymology words worth keeping and keep your notes with them.",
};

export default function NamesLabPage() {
  return <EtymologyLab corpus={labCorpus()} />;
}

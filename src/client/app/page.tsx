import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { hydraHeads } from "@/lib/config";
import { formatId } from "@/lib/utils";

export default function Home() {
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold leading-tight">
            HTLC + Vesting Demo
          </h1>
          <p className="text-muted-foreground">
            Select a Hydra head to open its dashboard and interact with HTLCs.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {hydraHeads.map((head) => (
            <Card key={head.headId} className="hover:shadow-md transition-shadow">
              <CardContent className="flex flex-col items-center space-y-4 p-6">
                <p className="text-base font-semibold">{head.name}</p>
                <div className="text-center space-y-1">
                  <div className="text-base text-muted-foreground">
                    Head ID: {formatId(head.headId)}
                  </div>
                  <div className="text-base text-muted-foreground">
                    Head Seed: {formatId(head.headSeed)}
                  </div>
                  <div className="text-base text-muted-foreground">
                    Status:{" "}
                    <span className={head.tag === "Open" ? "text-green-600" : ""}>
                      {head.tag}
                    </span>
                  </div>
                </div>
                <Button asChild className="w-full">
                  <Link href={`/${head.route}`}>Join</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}

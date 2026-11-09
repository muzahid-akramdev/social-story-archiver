/**
 * Fixture verification for parseGraphqlBucketMedia — synthetic NDJSON
 * in both documented shapes (direct api/graphql + SSR-embedded),
 * no live session involved. Run: npx tsx scripts/graphql-fixture-test.ts
 */
import { parseGraphqlBucketMedia } from "../src/lib/extraction/facebook";

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");

const line1 = JSON.stringify({
  data: {
    nodes: [
      {
        id: "bucket-122097978878821013",
        unified_stories: {
          edges: [
            {
              node: {
                id: b64("S:_ISC:1011567334924150"),
                story_card_info: { story_card_id: "1011567334924150" },
                attachments: [
                  {
                    media: {
                      __typename: "Photo",
                      image: {
                        uri: "https://scontent.fgxx1-1.fna.fbcdn.net/v/t39.30808-6/cardA_full.jpg?oh=aa&oe=bb",
                        width: 1080,
                        height: 1920,
                      },
                    },
                  },
                ],
              },
            },
            {
              node: {
                id: b64("S:_ISC:1011567334924999"),
                story_card_info: { story_card_id: "1011567334924999" },
                attachments: [
                  {
                    media: {
                      __typename: "Video",
                      videoDeliveryResponseFragment: {
                        videoDeliveryResponseResult: {
                          progressive_urls: [
                            {
                              progressive_url:
                                "https://video.fgxx1-1.fna.fbcdn.net/v/t42.1790-2/cardB_sd.mp4?oh=cc&oe=dd",
                              metadata: { quality: "SD" },
                            },
                            {
                              progressive_url:
                                "https://video.fgxx1-1.fna.fbcdn.net/v/t42.1790-2/cardB_hd.mp4?oh=ee&oe=ff",
                              metadata: { quality: "HD" },
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  },
});

const line2 = JSON.stringify({
  data: {
    node: {
      id: "bucket-122097978878821013",
      unified_stories_with_notes: {
        count: 3,
        edges: [
          {
            node: {
              id: b64("S:_ISC:1011567334924111"),
              attachments: [
                {
                  media: {
                    __typename: "Video",
                    playable_url:
                      "https://video.fgxx1-1.fna.fbcdn.net/v/t42.1790-2/cardC.mp4?oh=gg&oe=hh",
                  },
                },
              ],
            },
          },
          {
            node: {
              id: b64("S:_ISC:1011567334924222"),
              attachments: [
                {
                  media: {
                    __typename: "Photo",
                    image: {
                      uri: "https://scontent.fgxx1-1.fna.fbcdn.net/v/t39.30808-1/avatar_class.jpg?oh=ii&oe=jj",
                    },
                  },
                },
              ],
            },
          },
          {
            // Duplicate of card A under the other connection name — the
            // card-id dedupe must keep exactly one item for it.
            node: {
              id: b64("S:_ISC:1011567334924150"),
              story_card_info: { story_card_id: "1011567334924150" },
              attachments: [
                {
                  media: {
                    __typename: "Photo",
                    image: {
                      uri: "https://scontent.fgxx1-1.fna.fbcdn.net/v/t39.30808-6/cardA_dup.jpg?oh=kk&oe=ll",
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  },
});

const payload = `for (;;);${line1}\n${line2}\n`;
const items = parseGraphqlBucketMedia(payload);

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

check("3 items extracted", items.length === 3);
const a = items.find((i) => i.sourceId === "1011567334924150");
check("card A is the full-size photo", !!a && a.mediaType === "image" && a.mediaUrl.includes("cardA_full.jpg"));
const b = items.find((i) => i.sourceId === "1011567334924999");
check("card B picks the HD progressive URL", !!b && b.mediaType === "video" && b.mediaUrl.includes("cardB_hd.mp4"));
const c = items.find((i) => i.sourceId === "1011567334924111");
check("card C uses playable_url (id decoded from Relay token)", !!c && c.mediaType === "video" && c.mediaUrl.includes("cardC.mp4"));
check("avatar-class card D rejected", !items.some((i) => i.mediaUrl.includes("avatar_class")));
check("no duplicate card A", items.filter((i) => i.sourceId === "1011567334924150").length === 1);
check("empty text → no items", parseGraphqlBucketMedia("").length === 0);
check("garbage → no items", parseGraphqlBucketMedia("not json at all").length === 0);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

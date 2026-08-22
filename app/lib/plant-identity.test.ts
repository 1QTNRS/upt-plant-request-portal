import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bestPlantNameMatch,
  canonicalPlantKey,
  comparePlantNames,
  editDistance,
  parsePlantName,
} from "./plant-identity";

describe("canonical plant key", () => {
  it("folds capitalisation, spacing and punctuation", () => {
    const key = canonicalPlantKey("Hoya carnosa");
    for (const variant of [
      "hoya carnosa",
      "HOYA CARNOSA",
      "  Hoya   carnosa  ",
      "hoya\tcarnosa",
      "Hoya, carnosa",
      "Hoya-carnosa",
    ]) {
      assert.equal(canonicalPlantKey(variant), key, variant);
    }
  });

  it("treats a missing sp. as noise", () => {
    assert.equal(canonicalPlantKey("Hoya sp."), canonicalPlantKey("Hoya"));
    assert.equal(canonicalPlantKey("Hoya sp"), canonicalPlantKey("Hoya"));
  });

  it("keeps the customer's own wording untouched", () => {
    const parsed = parsePlantName("  HOYA  Carnosa  ");
    assert.equal(parsed.originalName, "  HOYA  Carnosa  ");
    // Tidied whitespace and nothing else: the label the owner reads is the
    // wording the shop used, not a re-cased version of it.
    assert.equal(parsed.displayName, "HOYA Carnosa");
  });

  it("reduces a collector code to the same tokens however it is written", () => {
    const key = canonicalPlantKey("Hoya sp. AH-021");
    assert.equal(canonicalPlantKey("Hoya sp. AH 021"), key);
    assert.equal(canonicalPlantKey("Hoya sp. AH021"), key);
    assert.equal(canonicalPlantKey("hoya ah-021"), key);
  });

  it("does not read a leading abbreviation as a rank word", () => {
    // `f.` opening a name is Ficus; only after a genus does it mark a form.
    assert.equal(parsePlantName("F. elastica").genus, "f.");
    assert.equal(parsePlantName("F. elastica").epithet, "elastica");
  });
});

describe("comparePlantNames", () => {
  const high = (left: string, right: string) => {
    const match = comparePlantNames(left, right);
    assert.equal(
      match.confidence,
      "high",
      `${left} vs ${right} should group automatically (got ${match.confidence}/${match.reason})`,
    );
    return match;
  };

  const notMerged = (left: string, right: string) => {
    const match = comparePlantNames(left, right);
    assert.notEqual(
      match.confidence,
      "high",
      `${left} vs ${right} must not be merged automatically`,
    );
    return match;
  };

  it("groups capitalisation and spacing differences", () => {
    assert.equal(high("Hoya carnosa", "hoya  carnosa").reason, "exact");
  });

  it("groups an abbreviated genus with the species written out", () => {
    assert.equal(
      high("H. carnosa", "Hoya carnosa").reason,
      "genus_abbreviation",
    );
  });

  it("groups a name that dropped sp.", () => {
    assert.equal(high("Hoya sp. carnosa", "Hoya carnosa").reason, "exact");
    assert.equal(high("Hoya sp.", "Hoya").reason, "exact");
  });

  it("groups a single mistyped character in the epithet", () => {
    // The two typos from the owner's own examples: one character dropped and
    // one doubled.
    assert.equal(high("Hoya carnsa", "Hoya carnosa").reason, "typo");
    assert.equal(high("Hoya carnoosa", "Hoya carnosa").reason, "typo");
  });

  it("only suggests when two characters differ", () => {
    const match = comparePlantNames("Hoya callistophylla", "Hoya calistophyla");
    assert.equal(match.confidence, "medium");
    assert.equal(match.reason, "typo");
  });

  it("leaves three characters apart alone entirely", () => {
    assert.equal(
      comparePlantNames("Hoya callistophylla", "Hoya calistofylla").confidence,
      "low",
    );
  });

  it("leaves a short epithet alone, where one edit is a large share of it", () => {
    // `bella` and `bilba` are five letters apart by one edit each way, and a
    // fifth of a word is far too much to forgive.
    assert.equal(comparePlantNames("Hoya bella", "Hoya balla").confidence, "low");
  });

  it("never merges a genus typo automatically", () => {
    const match = notMerged("Philodendron verrucosum", "Philodendran verrucosum");
    assert.equal(match.confidence, "medium");
  });

  it("keeps a quoted cultivar apart from the plain species", () => {
    const match = notMerged("Hoya carnosa 'Krimson Queen'", "Hoya carnosa");
    assert.equal(match.reason, "distinguishing_qualifier");
  });

  it("keeps two cultivars of one species apart", () => {
    notMerged("Hoya carnosa 'Krimson Queen'", "Hoya carnosa 'Krimson Princess'");
  });

  it("groups the same cultivar written with different quote marks", () => {
    high("Hoya carnosa 'Krimson Queen'", "hoya carnosa \u201cKrimson Queen\u201d");
  });

  it("keeps accession and collection numbers apart", () => {
    notMerged("Hoya sp. AH-021", "Hoya sp. AH-022");
    notMerged("Hoya sp. IML-0123", "Hoya sp. IML-0124");
    notMerged("Hoya sp. AH-021", "Hoya sp.");
  });

  it("keeps clone and seedling numbers apart", () => {
    notMerged("Hoya carnosa clone 3", "Hoya carnosa clone 4");
    notMerged("Anthurium seedling 7", "Anthurium seedling 8");
    notMerged("Hoya carnosa clone 3", "Hoya carnosa");
  });

  it("keeps localities apart", () => {
    notMerged("Hoya sp. ex Borneo", "Hoya sp. ex Sulawesi");
    notMerged("Hoya sp. ex Borneo", "Hoya sp.");
  });

  it("keeps an unquoted cultivar-style word apart", () => {
    // `compacta` is a different plant from plain `Hoya carnosa`, and nothing
    // deterministic can tell an unquoted cultivar from one that is quoted.
    notMerged("Hoya carnosa compacta", "Hoya carnosa");
  });

  it("does not forgive a typo inside a distinguishing qualifier", () => {
    notMerged("Hoya carnosa 'Krimson Queen'", "Hoya carnosa 'Krimsonn Queen'");
  });

  it("does not treat a genus-only request as a species", () => {
    notMerged("Hoya", "Hoya carnosa");
    notMerged("Hoya sp.", "Hoya carnosa");
  });

  it("keeps two different species apart", () => {
    notMerged("Hoya carnosa", "Hoya lacunosa");
    notMerged("Monstera deliciosa", "Monstera adansonii");
  });
});

describe("bestPlantNameMatch", () => {
  it("picks the closest identity", () => {
    const match = bestPlantNameMatch("H. carnosa", [
      { id: "a", names: ["Hoya lacunosa"] },
      { id: "b", names: ["Hoya carnosa"] },
    ]);
    assert.equal(match?.candidate.id, "b");
    assert.equal(match?.match.confidence, "high");
  });

  it("downgrades an ambiguous abbreviation to a question", () => {
    // `H.` fits both genera equally, and guessing one would silently attribute
    // the request to the wrong plant.
    const match = bestPlantNameMatch("H. carnosa", [
      { id: "hoya", names: ["Hoya carnosa"] },
      { id: "hedera", names: ["Hedera carnosa"] },
    ]);
    assert.equal(match?.match.confidence, "medium");
  });

  it("matches a spelling already recorded against an identity", () => {
    const match = bestPlantNameMatch("hoya carnossa", [
      { id: "a", names: ["Hoya obovata"] },
      { id: "b", names: ["Wax Plant", "Hoya carnosa"] },
    ]);
    assert.equal(match?.candidate.id, "b");
  });

  it("returns nothing when no identity is close", () => {
    assert.equal(
      bestPlantNameMatch("Monstera deliciosa", [{ id: "a", names: ["Hoya carnosa"] }]),
      null,
    );
  });
});

describe("editDistance", () => {
  it("counts single-character slips", () => {
    assert.equal(editDistance("carnosa", "carnsa"), 1);
    assert.equal(editDistance("carnosa", "carnoosa"), 1);
    assert.equal(editDistance("carnosa", "carnosa"), 0);
  });

  it("gives up past the limit rather than scoring a hopeless pair", () => {
    assert.ok(editDistance("carnosa", "deliciosa", 2) > 2);
  });
});

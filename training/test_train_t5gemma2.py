from __future__ import annotations

import json
import unittest

import infer_t5gemma2
import train_t5gemma2


class SilverExtractionSamplingTest(unittest.TestCase):
    def test_balances_real_and_synthetic_records(self) -> None:
        records = [
            record("real-a-positive", "audited-silver", "real-a", False),
            record("real-a-abstain", "audited-silver", "real-a", True),
            record("real-b-positive", "audited-silver", "real-b", False),
            record("real-b-abstain", "audited-silver", "real-b", True),
            record("synthetic-a-positive", "synthetic", "synthetic-a", False),
            record("synthetic-a-abstain", "synthetic", "synthetic-a", True),
            record("synthetic-b-positive", "synthetic", "synthetic-b", False),
            record("synthetic-b-abstain", "synthetic", "synthetic-b", True),
        ]

        selected = train_t5gemma2.mixed_silver_extraction_limit(
            records,
            8,
            silver_share=0.5,
            balance_abstentions=True,
        )

        self.assertEqual(len(selected), 8)
        self.assertEqual(
            sum(
                item["captureId"].startswith("audited-silver")
                for item in selected
            ),
            4,
        )
        self.assertEqual(
            {item["siteId"] for item in selected},
            {"real-a", "real-b", "synthetic-a", "synthetic-b"},
        )
        self.assertEqual(
            sum(
                "abstainReason" in json.loads(item["target"])["products"][0]
                for item in selected
            ),
            4,
        )

    def test_balances_pointer_abstentions(self) -> None:
        selected = train_t5gemma2.balanced_extraction_limit(
            [
                pointer_record("positive-a", "comparable"),
                pointer_record("positive-b", "comparable"),
                pointer_record("abstain-a", "conditional-price"),
                pointer_record("abstain-b", "price-range"),
            ],
            4,
        )

        self.assertEqual(
            [
                train_t5gemma2.parse_evidence_pointer(item["target"])["STATUS"]
                for item in selected
            ],
            [
                "comparable",
                "conditional-price",
                "comparable",
                "price-range",
            ],
        )

    def test_balances_domains_before_repeating_them(self) -> None:
        records = [
            {
                **pointer_record(f"{site}-{status}", status),
                "siteId": site,
            }
            for site in ("site-a", "site-b", "site-c", "site-d")
            for status in ("comparable", "conditional-price")
        ]
        records.append(
            {
                "id": "discovery",
                "task": "discover-products",
                "siteId": "site-z",
                "target": json.dumps(
                    {"version": 1, "pageId": "page", "cardNodeIds": ["card"]}
                ),
            }
        )

        selected = train_t5gemma2.domain_balanced_extraction_records(records)[:4]

        self.assertEqual(len({item["siteId"] for item in selected}), 4)
        self.assertEqual(
            sum(
                train_t5gemma2.parse_evidence_pointer(item["target"])[
                    "STATUS"
                ]
                == "comparable"
                for item in selected
            ),
            2,
        )


class EvidencePointerValidationTest(unittest.TestCase):
    def test_accepts_canonical_comparable_pointer(self) -> None:
        target = pointer_target("comparable")

        parsed = train_t5gemma2.parse_evidence_pointer(target)

        self.assertEqual(parsed["CURRENT_PRICE"], "price@p0")
        self.assertEqual(parsed["PACKAGE_QUANTITY"], "quantity@q0")

    def test_rejects_candidate_kind_mismatch(self) -> None:
        target = pointer_target("comparable").replace(
            "CURRENT_PRICE price@p0", "CURRENT_PRICE price@q0"
        )

        with self.assertRaisesRegex(ValueError, "CURRENT_PRICE"):
            train_t5gemma2.parse_evidence_pointer(target)

    def test_rejects_values_on_abstention(self) -> None:
        target = pointer_target("conditional-price").replace(
            "CURRENT_PRICE NONE", "CURRENT_PRICE price@p0"
        )

        with self.assertRaisesRegex(ValueError, "abstention"):
            train_t5gemma2.parse_evidence_pointer(target)

    def test_rejects_candidate_missing_from_prompt(self) -> None:
        pointer = train_t5gemma2.parse_evidence_pointer(
            pointer_target("comparable")
        )

        with self.assertRaisesRegex(ValueError, "quantity@q0"):
            train_t5gemma2.validate_pointer_prompt(
                "record",
                pointer,
                (
                    'CANDIDATES: [{"id":"price@p0"}]\n'
                    'OBSERVATION: {"nodes":[{"id":"card"},{"id":"title"}]}'
                ),
            )

    def test_canonicalizes_valid_seven_line_prefix(self) -> None:
        target = pointer_target("comparable")

        self.assertEqual(
            train_t5gemma2.canonical_pointer_generation(
                f"{target}\nCARD repeated"
            ),
            target,
        )
        self.assertEqual(
            infer_t5gemma2.canonical_pointer_generation(
                f"{target}\nCARD repeated"
            ),
            target,
        )


def record(
    record_id: str, capture_id: str, site_id: str, abstain: bool
) -> dict[str, object]:
    product: dict[str, object] = {
        "cardNodeId": "card",
        "title": {"value": "Product", "evidenceNodeIds": ["title"]},
    }
    if abstain:
        product["abstainReason"] = "insufficient-evidence"
    else:
        product["nativeUnitPrice"] = {
            "centsPerUnit": 10,
            "unit": "oz",
            "dimension": "mass",
            "evidenceNodeIds": ["unit"],
        }
    return {
        "id": record_id,
        "task": "extract-product",
        "captureId": capture_id,
        "siteId": site_id,
        "target": json.dumps(
            {"version": 1, "pageId": "page", "products": [product]}
        ),
    }


def pointer_record(record_id: str, status: str) -> dict[str, object]:
    return {
        "id": record_id,
        "task": "extract-product",
        "captureId": "synthetic",
        "siteId": "synthetic-a",
        "metadata": {"targetFormat": "evidence-pointer"},
        "target": pointer_target(status),
    }


def pointer_target(status: str) -> str:
    comparable = status == "comparable"
    return "\n".join(
        [
            "CARD card",
            "TITLE title",
            f"CURRENT_PRICE {'price@p0' if comparable else 'NONE'}",
            "NATIVE_UNIT_PRICE NONE",
            f"PACKAGE_QUANTITY {'quantity@q0' if comparable else 'NONE'}",
            "PACK_COUNT NONE",
            f"STATUS {status}",
        ]
    )


if __name__ == "__main__":
    unittest.main()

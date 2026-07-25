from __future__ import annotations

import json
import unittest

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


if __name__ == "__main__":
    unittest.main()

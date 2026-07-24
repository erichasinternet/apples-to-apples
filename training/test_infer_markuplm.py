#!/usr/bin/env python3
from __future__ import annotations

import unittest

from infer_markuplm import decode_card_node_ids


class DecodeCardNodeIdsTest(unittest.TestCase):
    def test_completes_evidence_bearing_siblings_and_rejects_skeletons(self) -> None:
        cards = [
            node("card-a", "row", 20),
            node("card-b", "row", 140),
            node("card-c", "row", 260),
        ]
        skeletons = [
            node("skeleton-a", "loading", 20, y=300),
            node("skeleton-b", "loading", 140, y=300),
        ]
        evidence = [
            node(f"text-{card['id']}", card["id"], card["bounds"]["x"], text="Coffee")
            for card in cards
        ]
        observation = {"nodes": [*cards, *skeletons, *evidence]}
        prepared = {
            "nodeIds": [entry["id"] for entry in [*cards, *skeletons]],
            "selectedNodes": [*cards, *skeletons],
        }
        scores = {
            "card-a": 0.55,
            "card-b": 0.8,
            "card-c": 0.82,
            "skeleton-a": 0.9,
            "skeleton-b": 0.91,
        }

        decoded = decode_card_node_ids(
            prepared,
            observation,
            {"x": 0, "y": 0, "width": 500, "height": 500},
            scores,
            0.7,
        )

        self.assertEqual(decoded, ["card-a", "card-b", "card-c"])

    def test_rejects_horizontally_clipped_sibling(self) -> None:
        cards = [
            node("card-a", "row", 20),
            node("card-b", "row", 140),
            node("card-clipped", "row", 490),
        ]
        evidence = [
            node(f"text-{card['id']}", card["id"], card["bounds"]["x"], text="Coffee")
            for card in cards
        ]
        prepared = {
            "nodeIds": [entry["id"] for entry in cards],
            "selectedNodes": cards,
        }
        scores = {entry["id"]: 0.9 for entry in cards}

        decoded = decode_card_node_ids(
            prepared,
            {"nodes": [*cards, *evidence]},
            {"x": 0, "y": 0, "width": 500, "height": 500},
            scores,
            0.7,
        )

        self.assertEqual(decoded, ["card-a", "card-b"])


def node(
    node_id: str,
    parent: str | None,
    x: float,
    *,
    y: float = 20,
    text: str | None = None,
) -> dict:
    return {
        "id": node_id,
        **({"parent": parent} if parent else {}),
        "tag": "span" if text else "li",
        **({"text": text} if text else {}),
        "attributes": {},
        "bounds": {
            "x": x,
            "y": y,
            "width": 100,
            "height": 200 if not text else 20,
        },
    }


if __name__ == "__main__":
    unittest.main()

# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from xml.etree import ElementTree  # nosec B405


class _NoDTDTreeBuilder(ElementTree.TreeBuilder):
    def doctype(self, _name: str, _pubid: str | None, _system: str | None) -> None:
        raise ElementTree.ParseError("XML document type declarations are not supported.")


def parse_xml(source: bytes | str) -> ElementTree.Element:
    parser = ElementTree.XMLParser(target=_NoDTDTreeBuilder())  # nosec B314
    parser.feed(source)
    return parser.close()
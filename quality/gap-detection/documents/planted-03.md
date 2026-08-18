# Stock reservation requirements

## Purpose

Stop the store from selling the same unit twice.

## Rules

1. Stock is reserved immediately when a customer places an order.
2. A reservation is released when the order is cancelled or expires.
3. A reservation expires after 30 minutes.
4. The store never shows a quantity higher than the warehouse reports.
5. A partially fulfilled order keeps its reservation for the remaining units.

## Warehouse

Quantities come from the warehouse service. The store reads them through the
warehouse inventory endpoint on every product page view.

## Out of scope

Back-orders and supplier lead times.

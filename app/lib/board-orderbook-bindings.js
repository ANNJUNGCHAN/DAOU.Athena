// Exact typed quote fields for the authored regular-session tables and primary summary.
(function () {
'use strict';
const bindings = {
  "13BC-2": [
    { "slot": "s013", "key": "sellPrices", "index": 0 },
    { "slot": "s014", "key": "sellQuantities", "index": 0 },
    { "slot": "s016", "key": "buyPrices", "index": 0 },
    { "slot": "s017", "key": "buyQuantities", "index": 0 }
  ],
  "2TRW-1": [
    {
      "slot": "s013",
      "key": "sellPrices",
      "index": 0
    },
    {
      "slot": "s014",
      "key": "sellQuantities",
      "index": 0
    },
    {
      "slot": "s016",
      "key": "buyPrices",
      "index": 0
    },
    {
      "slot": "s017",
      "key": "buyQuantities",
      "index": 0
    },
    {
      "slot": "s020",
      "key": "time"
    },
    {
      "slot": "s029",
      "key": "sellPrices",
      "index": 4
    },
    {
      "slot": "s031",
      "key": "sellQuantities",
      "index": 4
    },
    {
      "slot": "s032",
      "key": "sellPrices",
      "index": 3
    },
    {
      "slot": "s034",
      "key": "sellQuantities",
      "index": 3
    },
    {
      "slot": "s035",
      "key": "sellPrices",
      "index": 2
    },
    {
      "slot": "s037",
      "key": "sellQuantities",
      "index": 2
    },
    {
      "slot": "s038",
      "key": "sellPrices",
      "index": 1
    },
    {
      "slot": "s040",
      "key": "sellQuantities",
      "index": 1
    },
    {
      "slot": "s041",
      "key": "sellPrices",
      "index": 0
    },
    {
      "slot": "s043",
      "key": "sellQuantities",
      "index": 0
    },
    {
      "slot": "s048",
      "key": "buyPrices",
      "index": 0
    },
    {
      "slot": "s050",
      "key": "buyQuantities",
      "index": 0
    },
    {
      "slot": "s051",
      "key": "buyPrices",
      "index": 1
    },
    {
      "slot": "s053",
      "key": "buyQuantities",
      "index": 1
    },
    {
      "slot": "s054",
      "key": "buyPrices",
      "index": 2
    },
    {
      "slot": "s056",
      "key": "buyQuantities",
      "index": 2
    },
    {
      "slot": "s057",
      "key": "buyPrices",
      "index": 3
    },
    {
      "slot": "s059",
      "key": "buyQuantities",
      "index": 3
    },
    {
      "slot": "s060",
      "key": "buyPrices",
      "index": 4
    },
    {
      "slot": "s062",
      "key": "buyQuantities",
      "index": 4
    },
    {
      "slot": "s066",
      "key": "sellTotal"
    },
    {
      "slot": "s069",
      "key": "buyTotal"
    },
    {
      "slot": "s141",
      "key": "sellTotal"
    },
    {
      "slot": "s142",
      "key": "buyTotal"
    },
    {
      "slot": "s143",
      "key": "sellPrices",
      "index": 0
    }
  ],
  "3JZ3-0": [
    {
      "slot": "s013",
      "key": "sellPrices",
      "index": 0
    },
    {
      "slot": "s014",
      "key": "sellQuantities",
      "index": 0
    },
    {
      "slot": "s016",
      "key": "buyPrices",
      "index": 0
    },
    {
      "slot": "s017",
      "key": "buyQuantities",
      "index": 0
    },
    {
      "slot": "s020",
      "key": "time"
    },
    {
      "slot": "s029",
      "key": "sellTotal"
    },
    {
      "slot": "s031",
      "key": "sellPrices",
      "index": 9
    },
    {
      "slot": "s032",
      "key": "sellQuantities",
      "index": 9
    },
    {
      "slot": "s033",
      "key": "sellChanges",
      "index": 9
    },
    {
      "slot": "s034",
      "key": "krxSellQuantities",
      "index": 9
    },
    {
      "slot": "s035",
      "key": "nxtSellQuantities",
      "index": 9
    },
    {
      "slot": "s036",
      "key": "sellLpQuantities",
      "index": 9
    },
    {
      "slot": "s038",
      "key": "sellPrices",
      "index": 8
    },
    {
      "slot": "s039",
      "key": "sellQuantities",
      "index": 8
    },
    {
      "slot": "s040",
      "key": "sellChanges",
      "index": 8
    },
    {
      "slot": "s041",
      "key": "krxSellQuantities",
      "index": 8
    },
    {
      "slot": "s042",
      "key": "nxtSellQuantities",
      "index": 8
    },
    {
      "slot": "s043",
      "key": "sellLpQuantities",
      "index": 8
    },
    {
      "slot": "s045",
      "key": "sellPrices",
      "index": 7
    },
    {
      "slot": "s046",
      "key": "sellQuantities",
      "index": 7
    },
    {
      "slot": "s047",
      "key": "sellChanges",
      "index": 7
    },
    {
      "slot": "s048",
      "key": "krxSellQuantities",
      "index": 7
    },
    {
      "slot": "s049",
      "key": "nxtSellQuantities",
      "index": 7
    },
    {
      "slot": "s050",
      "key": "sellLpQuantities",
      "index": 7
    },
    {
      "slot": "s052",
      "key": "sellPrices",
      "index": 6
    },
    {
      "slot": "s053",
      "key": "sellQuantities",
      "index": 6
    },
    {
      "slot": "s054",
      "key": "sellChanges",
      "index": 6
    },
    {
      "slot": "s055",
      "key": "krxSellQuantities",
      "index": 6
    },
    {
      "slot": "s056",
      "key": "nxtSellQuantities",
      "index": 6
    },
    {
      "slot": "s057",
      "key": "sellLpQuantities",
      "index": 6
    },
    {
      "slot": "s059",
      "key": "sellPrices",
      "index": 5
    },
    {
      "slot": "s060",
      "key": "sellQuantities",
      "index": 5
    },
    {
      "slot": "s061",
      "key": "sellChanges",
      "index": 5
    },
    {
      "slot": "s062",
      "key": "krxSellQuantities",
      "index": 5
    },
    {
      "slot": "s063",
      "key": "nxtSellQuantities",
      "index": 5
    },
    {
      "slot": "s064",
      "key": "sellLpQuantities",
      "index": 5
    },
    {
      "slot": "s066",
      "key": "sellPrices",
      "index": 4
    },
    {
      "slot": "s067",
      "key": "sellQuantities",
      "index": 4
    },
    {
      "slot": "s068",
      "key": "sellChanges",
      "index": 4
    },
    {
      "slot": "s069",
      "key": "krxSellQuantities",
      "index": 4
    },
    {
      "slot": "s070",
      "key": "nxtSellQuantities",
      "index": 4
    },
    {
      "slot": "s071",
      "key": "sellLpQuantities",
      "index": 4
    },
    {
      "slot": "s073",
      "key": "sellPrices",
      "index": 3
    },
    {
      "slot": "s074",
      "key": "sellQuantities",
      "index": 3
    },
    {
      "slot": "s075",
      "key": "sellChanges",
      "index": 3
    },
    {
      "slot": "s076",
      "key": "krxSellQuantities",
      "index": 3
    },
    {
      "slot": "s077",
      "key": "nxtSellQuantities",
      "index": 3
    },
    {
      "slot": "s078",
      "key": "sellLpQuantities",
      "index": 3
    },
    {
      "slot": "s080",
      "key": "sellPrices",
      "index": 2
    },
    {
      "slot": "s081",
      "key": "sellQuantities",
      "index": 2
    },
    {
      "slot": "s082",
      "key": "sellChanges",
      "index": 2
    },
    {
      "slot": "s083",
      "key": "krxSellQuantities",
      "index": 2
    },
    {
      "slot": "s084",
      "key": "nxtSellQuantities",
      "index": 2
    },
    {
      "slot": "s085",
      "key": "sellLpQuantities",
      "index": 2
    },
    {
      "slot": "s087",
      "key": "sellPrices",
      "index": 1
    },
    {
      "slot": "s088",
      "key": "sellQuantities",
      "index": 1
    },
    {
      "slot": "s089",
      "key": "sellChanges",
      "index": 1
    },
    {
      "slot": "s090",
      "key": "krxSellQuantities",
      "index": 1
    },
    {
      "slot": "s091",
      "key": "nxtSellQuantities",
      "index": 1
    },
    {
      "slot": "s092",
      "key": "sellLpQuantities",
      "index": 1
    },
    {
      "slot": "s094",
      "key": "sellPrices",
      "index": 0
    },
    {
      "slot": "s095",
      "key": "sellQuantities",
      "index": 0
    },
    {
      "slot": "s096",
      "key": "sellChanges",
      "index": 0
    },
    {
      "slot": "s097",
      "key": "krxSellQuantities",
      "index": 0
    },
    {
      "slot": "s098",
      "key": "nxtSellQuantities",
      "index": 0
    },
    {
      "slot": "s099",
      "key": "sellLpQuantities",
      "index": 0
    },
    {
      "slot": "s101",
      "key": "sellTotal"
    },
    {
      "slot": "s102",
      "key": "sellTotalChange"
    },
    {
      "slot": "s103",
      "key": "krxSellTotal"
    },
    {
      "slot": "s104",
      "key": "nxtSellTotal"
    },
    {
      "slot": "s111",
      "key": "buyTotal"
    },
    {
      "slot": "s113",
      "key": "buyPrices",
      "index": 0
    },
    {
      "slot": "s114",
      "key": "buyQuantities",
      "index": 0
    },
    {
      "slot": "s115",
      "key": "buyChanges",
      "index": 0
    },
    {
      "slot": "s116",
      "key": "krxBuyQuantities",
      "index": 0
    },
    {
      "slot": "s117",
      "key": "nxtBuyQuantities",
      "index": 0
    },
    {
      "slot": "s118",
      "key": "buyLpQuantities",
      "index": 0
    },
    {
      "slot": "s120",
      "key": "buyPrices",
      "index": 1
    },
    {
      "slot": "s121",
      "key": "buyQuantities",
      "index": 1
    },
    {
      "slot": "s122",
      "key": "buyChanges",
      "index": 1
    },
    {
      "slot": "s123",
      "key": "krxBuyQuantities",
      "index": 1
    },
    {
      "slot": "s124",
      "key": "nxtBuyQuantities",
      "index": 1
    },
    {
      "slot": "s125",
      "key": "buyLpQuantities",
      "index": 1
    },
    {
      "slot": "s127",
      "key": "buyPrices",
      "index": 2
    },
    {
      "slot": "s128",
      "key": "buyQuantities",
      "index": 2
    },
    {
      "slot": "s129",
      "key": "buyChanges",
      "index": 2
    },
    {
      "slot": "s130",
      "key": "krxBuyQuantities",
      "index": 2
    },
    {
      "slot": "s131",
      "key": "nxtBuyQuantities",
      "index": 2
    },
    {
      "slot": "s132",
      "key": "buyLpQuantities",
      "index": 2
    },
    {
      "slot": "s134",
      "key": "buyPrices",
      "index": 3
    },
    {
      "slot": "s135",
      "key": "buyQuantities",
      "index": 3
    },
    {
      "slot": "s136",
      "key": "buyChanges",
      "index": 3
    },
    {
      "slot": "s137",
      "key": "krxBuyQuantities",
      "index": 3
    },
    {
      "slot": "s138",
      "key": "nxtBuyQuantities",
      "index": 3
    },
    {
      "slot": "s139",
      "key": "buyLpQuantities",
      "index": 3
    },
    {
      "slot": "s141",
      "key": "buyPrices",
      "index": 4
    },
    {
      "slot": "s142",
      "key": "buyQuantities",
      "index": 4
    },
    {
      "slot": "s143",
      "key": "buyChanges",
      "index": 4
    },
    {
      "slot": "s144",
      "key": "krxBuyQuantities",
      "index": 4
    },
    {
      "slot": "s145",
      "key": "nxtBuyQuantities",
      "index": 4
    },
    {
      "slot": "s146",
      "key": "buyLpQuantities",
      "index": 4
    },
    {
      "slot": "s148",
      "key": "buyPrices",
      "index": 5
    },
    {
      "slot": "s149",
      "key": "buyQuantities",
      "index": 5
    },
    {
      "slot": "s150",
      "key": "buyChanges",
      "index": 5
    },
    {
      "slot": "s151",
      "key": "krxBuyQuantities",
      "index": 5
    },
    {
      "slot": "s152",
      "key": "nxtBuyQuantities",
      "index": 5
    },
    {
      "slot": "s153",
      "key": "buyLpQuantities",
      "index": 5
    },
    {
      "slot": "s155",
      "key": "buyPrices",
      "index": 6
    },
    {
      "slot": "s156",
      "key": "buyQuantities",
      "index": 6
    },
    {
      "slot": "s157",
      "key": "buyChanges",
      "index": 6
    },
    {
      "slot": "s158",
      "key": "krxBuyQuantities",
      "index": 6
    },
    {
      "slot": "s159",
      "key": "nxtBuyQuantities",
      "index": 6
    },
    {
      "slot": "s160",
      "key": "buyLpQuantities",
      "index": 6
    },
    {
      "slot": "s162",
      "key": "buyPrices",
      "index": 7
    },
    {
      "slot": "s163",
      "key": "buyQuantities",
      "index": 7
    },
    {
      "slot": "s164",
      "key": "buyChanges",
      "index": 7
    },
    {
      "slot": "s165",
      "key": "krxBuyQuantities",
      "index": 7
    },
    {
      "slot": "s166",
      "key": "nxtBuyQuantities",
      "index": 7
    },
    {
      "slot": "s167",
      "key": "buyLpQuantities",
      "index": 7
    },
    {
      "slot": "s169",
      "key": "buyPrices",
      "index": 8
    },
    {
      "slot": "s170",
      "key": "buyQuantities",
      "index": 8
    },
    {
      "slot": "s171",
      "key": "buyChanges",
      "index": 8
    },
    {
      "slot": "s172",
      "key": "krxBuyQuantities",
      "index": 8
    },
    {
      "slot": "s173",
      "key": "nxtBuyQuantities",
      "index": 8
    },
    {
      "slot": "s174",
      "key": "buyLpQuantities",
      "index": 8
    },
    {
      "slot": "s176",
      "key": "buyPrices",
      "index": 9
    },
    {
      "slot": "s177",
      "key": "buyQuantities",
      "index": 9
    },
    {
      "slot": "s178",
      "key": "buyChanges",
      "index": 9
    },
    {
      "slot": "s179",
      "key": "krxBuyQuantities",
      "index": 9
    },
    {
      "slot": "s180",
      "key": "nxtBuyQuantities",
      "index": 9
    },
    {
      "slot": "s181",
      "key": "buyLpQuantities",
      "index": 9
    },
    {
      "slot": "s183",
      "key": "buyTotal"
    },
    {
      "slot": "s184",
      "key": "buyTotalChange"
    },
    {
      "slot": "s185",
      "key": "krxBuyTotal"
    },
    {
      "slot": "s186",
      "key": "nxtBuyTotal"
    },
    {
      "slot": "s192",
      "key": "sellTotal"
    },
    {
      "slot": "s193",
      "key": "sellTotalChange"
    },
    {
      "slot": "s195",
      "key": "buyTotal"
    },
    {
      "slot": "s196",
      "key": "buyTotalChange"
    }
  ],
  "3N4O-0": [
    {
      "slot": "s018",
      "key": "sellPrices",
      "index": 9
    },
    {
      "slot": "s019",
      "key": "sellQuantities",
      "index": 9
    },
    {
      "slot": "s020",
      "key": "sellChanges",
      "index": 9
    },
    {
      "slot": "s022",
      "key": "sellLpQuantities",
      "index": 9
    },
    {
      "slot": "s024",
      "key": "sellPrices",
      "index": 8
    },
    {
      "slot": "s025",
      "key": "sellQuantities",
      "index": 8
    },
    {
      "slot": "s026",
      "key": "sellChanges",
      "index": 8
    },
    {
      "slot": "s028",
      "key": "sellLpQuantities",
      "index": 8
    },
    {
      "slot": "s030",
      "key": "sellPrices",
      "index": 7
    },
    {
      "slot": "s031",
      "key": "sellQuantities",
      "index": 7
    },
    {
      "slot": "s032",
      "key": "sellChanges",
      "index": 7
    },
    {
      "slot": "s034",
      "key": "sellLpQuantities",
      "index": 7
    },
    {
      "slot": "s036",
      "key": "sellPrices",
      "index": 6
    },
    {
      "slot": "s037",
      "key": "sellQuantities",
      "index": 6
    },
    {
      "slot": "s038",
      "key": "sellChanges",
      "index": 6
    },
    {
      "slot": "s040",
      "key": "sellLpQuantities",
      "index": 6
    },
    {
      "slot": "s042",
      "key": "sellPrices",
      "index": 5
    },
    {
      "slot": "s043",
      "key": "sellQuantities",
      "index": 5
    },
    {
      "slot": "s044",
      "key": "sellChanges",
      "index": 5
    },
    {
      "slot": "s046",
      "key": "sellLpQuantities",
      "index": 5
    },
    {
      "slot": "s048",
      "key": "sellPrices",
      "index": 4
    },
    {
      "slot": "s049",
      "key": "sellQuantities",
      "index": 4
    },
    {
      "slot": "s050",
      "key": "sellChanges",
      "index": 4
    },
    {
      "slot": "s052",
      "key": "sellLpQuantities",
      "index": 4
    },
    {
      "slot": "s054",
      "key": "sellPrices",
      "index": 3
    },
    {
      "slot": "s055",
      "key": "sellQuantities",
      "index": 3
    },
    {
      "slot": "s056",
      "key": "sellChanges",
      "index": 3
    },
    {
      "slot": "s058",
      "key": "sellLpQuantities",
      "index": 3
    },
    {
      "slot": "s060",
      "key": "sellPrices",
      "index": 2
    },
    {
      "slot": "s061",
      "key": "sellQuantities",
      "index": 2
    },
    {
      "slot": "s062",
      "key": "sellChanges",
      "index": 2
    },
    {
      "slot": "s064",
      "key": "sellLpQuantities",
      "index": 2
    },
    {
      "slot": "s066",
      "key": "sellPrices",
      "index": 1
    },
    {
      "slot": "s067",
      "key": "sellQuantities",
      "index": 1
    },
    {
      "slot": "s068",
      "key": "sellChanges",
      "index": 1
    },
    {
      "slot": "s070",
      "key": "sellLpQuantities",
      "index": 1
    },
    {
      "slot": "s072",
      "key": "sellPrices",
      "index": 0
    },
    {
      "slot": "s073",
      "key": "sellQuantities",
      "index": 0
    },
    {
      "slot": "s074",
      "key": "sellChanges",
      "index": 0
    },
    {
      "slot": "s076",
      "key": "sellLpQuantities",
      "index": 0
    },
    {
      "slot": "s079",
      "key": "sellTotal"
    },
    {
      "slot": "s089",
      "key": "buyPrices",
      "index": 0
    },
    {
      "slot": "s090",
      "key": "buyQuantities",
      "index": 0
    },
    {
      "slot": "s091",
      "key": "buyChanges",
      "index": 0
    },
    {
      "slot": "s093",
      "key": "buyLpQuantities",
      "index": 0
    },
    {
      "slot": "s095",
      "key": "buyPrices",
      "index": 1
    },
    {
      "slot": "s096",
      "key": "buyQuantities",
      "index": 1
    },
    {
      "slot": "s097",
      "key": "buyChanges",
      "index": 1
    },
    {
      "slot": "s099",
      "key": "buyLpQuantities",
      "index": 1
    },
    {
      "slot": "s101",
      "key": "buyPrices",
      "index": 2
    },
    {
      "slot": "s102",
      "key": "buyQuantities",
      "index": 2
    },
    {
      "slot": "s103",
      "key": "buyChanges",
      "index": 2
    },
    {
      "slot": "s105",
      "key": "buyLpQuantities",
      "index": 2
    },
    {
      "slot": "s107",
      "key": "buyPrices",
      "index": 3
    },
    {
      "slot": "s108",
      "key": "buyQuantities",
      "index": 3
    },
    {
      "slot": "s109",
      "key": "buyChanges",
      "index": 3
    },
    {
      "slot": "s111",
      "key": "buyLpQuantities",
      "index": 3
    },
    {
      "slot": "s113",
      "key": "buyPrices",
      "index": 4
    },
    {
      "slot": "s114",
      "key": "buyQuantities",
      "index": 4
    },
    {
      "slot": "s115",
      "key": "buyChanges",
      "index": 4
    },
    {
      "slot": "s117",
      "key": "buyLpQuantities",
      "index": 4
    },
    {
      "slot": "s119",
      "key": "buyPrices",
      "index": 5
    },
    {
      "slot": "s120",
      "key": "buyQuantities",
      "index": 5
    },
    {
      "slot": "s121",
      "key": "buyChanges",
      "index": 5
    },
    {
      "slot": "s123",
      "key": "buyLpQuantities",
      "index": 5
    },
    {
      "slot": "s125",
      "key": "buyPrices",
      "index": 6
    },
    {
      "slot": "s126",
      "key": "buyQuantities",
      "index": 6
    },
    {
      "slot": "s127",
      "key": "buyChanges",
      "index": 6
    },
    {
      "slot": "s129",
      "key": "buyLpQuantities",
      "index": 6
    },
    {
      "slot": "s131",
      "key": "buyPrices",
      "index": 7
    },
    {
      "slot": "s132",
      "key": "buyQuantities",
      "index": 7
    },
    {
      "slot": "s133",
      "key": "buyChanges",
      "index": 7
    },
    {
      "slot": "s135",
      "key": "buyLpQuantities",
      "index": 7
    },
    {
      "slot": "s137",
      "key": "buyPrices",
      "index": 8
    },
    {
      "slot": "s138",
      "key": "buyQuantities",
      "index": 8
    },
    {
      "slot": "s139",
      "key": "buyChanges",
      "index": 8
    },
    {
      "slot": "s141",
      "key": "buyLpQuantities",
      "index": 8
    },
    {
      "slot": "s143",
      "key": "buyPrices",
      "index": 9
    },
    {
      "slot": "s144",
      "key": "buyQuantities",
      "index": 9
    },
    {
      "slot": "s145",
      "key": "buyChanges",
      "index": 9
    },
    {
      "slot": "s147",
      "key": "buyLpQuantities",
      "index": 9
    },
    {
      "slot": "s150",
      "key": "buyTotal"
    },
    {
      "slot": "s157",
      "key": "sellTotal"
    },
    {
      "slot": "s159",
      "key": "buyTotal"
    }
  ]
};
if (typeof module !== 'undefined' && module.exports) module.exports = bindings;
else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.BoardOrderbookBindings = bindings; }
})();

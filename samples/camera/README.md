# Camera

This directory contains setup scripts and guides for Intel IPU-based camera support on Ubuntu*, covering two connection types: **GMSL** (long-distance automotive) and **MIPI** (direct short-distance).

---

## Table of Contents
- [Camera Connection Types](#camera-connection-types)
- [Validated Hardware](#validated-hardware)
- MIPI camera topic
   - [MIPI Quick Start Guide for IPU6](./QSG_MIPI.md)
   - [MIPI setup script](./mipi.sh)
- GMSL camera topic
   - [GMSL Quick Start Guide for IPU6](./QSG_GMSL_IPU6.md) 
   - [GMSL Quick Start Guide for IPU7](./QSG_GMSL_IPU7.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)

---

## Camera Connection Types

### MIPI (Mobile Industry Processor Interface)
MIPI CSI-2 is a high-speed serial interface that connects image sensors directly to the host SoC/processor. No deserializer is required. Used for short-distance, embedded camera connections.

### GMSL (Gigabit Multimedia Serial Link)
GMSL is a high-speed serial link for long-distance automotive camera connections over coaxial or shielded twisted-pair cables. A **deserializer** (e.g., MAX96724 AIC or MAX9296 AIC) is required on the receiving end to convert the serial GMSL signal into a MIPI/parallel stream for the SoC.

---

## Validated Hardware

### GMSL

| Product Collection | IPU Version | Camera Module | Validated Hardware | Deserializer |
|---|---|---|---|---|
| 12th/13th/14th Gen Intel® Core™ | IPU 6 | [RealSense™ Depth Camera D457](https://www.realsenseai.com/products/d457-gmsl-fakra/)<br>[D3 Embedded® ISX031](https://www.d3embedded.com/product/isx031-smart-camera-wide-fov-gmsl2-unsealed/)<br>[D3 Embedded® IMX390](https://www.d3embedded.com/product/imx390-medium-fov-gmsl2-sealed/)<br>[oToBrite® ISX031](https://www.otobrite.com/product/automotive-camera/isx031_gmsl2_otocam223-s195m)<br>[oToBrite® ISX021](https://www.otobrite.com/product/automotive-camera/isx021_gmsl2_otocam222-c120m) | [Axiomtek* ROBOX500](https://www.axiomtek.com/ROBOX500/) | MAX 9296 DPHY 
| Intel® Core™ Ultra Series 1 and 2 | IPU 6 | [RealSense™ Depth Camera D457](https://www.realsenseai.com/products/d457-gmsl-fakra/)<br>[D3 Embedded® ISX031](https://www.d3embedded.com/product/isx031-smart-camera-wide-fov-gmsl2-unsealed/)<br>[D3 Embedded® IMX390](https://www.d3embedded.com/product/imx390-medium-fov-gmsl2-sealed/)<br>[oToBrite® ISX031](https://www.otobrite.com/product/automotive-camera/isx031_gmsl2_otocam223-s195m)<br>[oToBrite® ISX021](https://www.otobrite.com/product/automotive-camera/isx021_gmsl2_otocam222-c120m) | [SEAVO* Embedded Computer HB03](https://www.seavo.com/en/products/products-info_itemid_693.html)<br>[Advantech* AFE-R360 series](https://www.advantech.com/en-eu/products/8d5aadd0-1ef5-4704-a9a1-504718fb3b41/afe-r360/mod_1e4a1980-9a31-46e6-87b6-affbd7a2cb44) and [ASR-A502 series](https://www.advantech.com/en-eu/products/8d5aadd0-1ef5-4704-a9a1-504718fb3b41/asr-a502/mod_ccca0f36-a50b-40c7-87b7-10fb96448605) with [Advantech GMSL Input Module Card](https://www.advantech.com/en-eu/products/8d5aadd0-1ef5-4704-a9a1-504718fb3b41/mioe-gmsl/mod_fc1fc070-30f8-40c1-881f-56c967e26924) | MAX 9296 DPHY
| Intel® Core™ Ultra Processors (Series 3) | IPU 7 | [D3 Embedded® ISX031](https://www.d3embedded.com/product/isx031-smart-camera-wide-fov-gmsl2-unsealed/) | [Innodisk Intel® Core™ Ultra Series 3 Reference Kit](https://www.innodisk.com/en/blog/intel-core-ultra-series3-reference-kit) | MAX 96724 CPHY 

### MIPI

| Product Collection | IPU Version | Camera Module | Validated Hardware |
|---|---|---|---|
| Intel® Core™ Ultra Series 2 | IPU 6 |  [D3 Embedded® AR0234](https://www.d3embedded.com/product/ar0234-medium-fov-samtec-mipi-unsealed/) | [Innodisk Intel® Core™ Ultra Series 2 Reference Kit](https://www.innodisk.com/en/blog/intel-core-ultra-series2-reference-kit)

---


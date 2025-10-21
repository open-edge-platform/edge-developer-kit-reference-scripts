# Smart Parking Application

The smart parking application is an AI-based solution to monitor individual car parking spaces and their occupancy statuses in a car park. The model [vehicle-detection-0201](https://github.com/openvinotoolkit/open_model_zoo/blob/master/models/intel/vehicle-detection-0201/README.md) from Open Model Zoo is used for car detection in this application.

![demo](./docs/demo.gif)

## Requirements
### Validated hardware
* CPU: 13th generations of Intel Core processors and above
* GPU: Intel® Arc™ graphics
* RAM: 32GB
* DISK: 128GB

## Setup

### Prequisite
* **OS**: Ubuntu 24.04 LTS

* **Docker and Docker Compose**: Ensure Docker and Docker Compose are installed. Refer to [Docker installation guide](https://docs.docker.com/engine/install/).

* **Intel GPU Drivers**:
Refer to [here](../../../README.md#-5-minute-quick-start) to install Intel GPU Drivers

### Generate SSL certs

```
bash setup/generate-certs.sh
```

### Download sample video 

```
wget https://videos.pexels.com/video-files/30937634/13228649_1920_1080_30fps.mp4 -O server/resources/carpark_video_1.mp4
```

### Build Image

```
docker compose build
```

### Start containers

```
docker compose up -d
```

### Stop containers

```
docker compose down
```

### Access streams

* View all camera streams: https://localhost/camera/all

  ![all_cam](./docs/all_cam.png)

* View specific camera stream: https://localhost/camera/<no_of_camera_stream>

  ![one_cam](./docs/one_cam.png)

### Grafana dashboard

**Recommended web browser: Firefox**

1. Login
    - https://localhost/grafana/login
    - Username: admin
    - Password: admin

2. Add data source

    - Choose InfluxDB as the data source
    - Fill in URL
      - http://influxdb:8086
    - Turn on Auth and fill in the basic auth details
      - Username: admin
      - Password: admin
    - Fill in InfluxDB details
      - Database: carpark_data
      - HTTP Method: POST

    ![data_source](./docs/grafana_data_source.png)

    - Save and test

3. Import template from grafana folder

    ![import_dashboard](./docs/import_dashboard.png)

## Notes
### Model Configuration
You can change the model to pretrained YOLOv8-n by replacing line 37 and 38 in server/utils/video_stream.py with code below:

```
self.detector_yolo = CarDetectorYolo(f'./model/{model_name}_int8_openvino_model/{model_name}.xml', device="CPU")
self.detector_omz = None
```

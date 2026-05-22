# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from influxdb.exceptions import InfluxDBServerError
import time


def influx(carpark_data, influxclient):

    # first measurement - detail
    data_detail = []
    for site_key_1, site_value_1 in carpark_data.items():
        if isinstance(site_value_1, dict):
            for level_key_1, level_value_1 in site_value_1.items():
                if isinstance(level_value_1, dict):
                    for row_key_1, row_value_1 in level_value_1.items():
                        tags_1 = {'Site': site_key_1,
                                  'Level': level_key_1, 'Row': row_key_1}
                        fields_1 = {}
                        for slot_key_1, slot_value_1 in row_value_1.items():
                            if slot_key_1 not in ['Total', 'Occupied', 'Unoccupied']:
                                fields_1['C' + slot_key_1] = slot_value_1
                        fields_1.update(
                            {'Total': row_value_1['Total'], 'Occupied': row_value_1['Occupied'], 'Unoccupied': row_value_1['Unoccupied']})
                        data_point_1 = {'measurement': 'detail',
                                        'tags': tags_1, 'fields': fields_1}
                        data_detail.append(data_point_1)

    # second measurement - summary level
    data_summary_level = []
    for site_key_2, site_value_2 in carpark_data.items():
        fields_2 = {}
        if isinstance(site_value_2, dict):
            if site_key_2 not in [list(carpark_data.keys())[0]]:
                tags_2 = {'Level': site_key_2}
                fields_2.update(
                    {'Total': site_value_2['Total'], 'Occupied': site_value_2['Occupied'], 'Unoccupied': site_value_2['Unoccupied']})
                data_point_2 = {'measurement': 'summary_level',
                                'tags': tags_2, 'fields': fields_2}
                data_summary_level.append(data_point_2)

    # third measurement - summary site
    data_summary_site = []
    for _, site_value_3 in carpark_data.items():
        tags_3 = {'Site': list(carpark_data.keys())[0]}
        fields_3 = {}
        if isinstance(site_value_3, int):
            fields_3.update({'Total': carpark_data['TotalCarpark'], 'Occupied': carpark_data[
                            'TotalOccupiedCarpark'], 'Unoccupied': carpark_data['TotalUnoccupiedCarpark']})
            data_point_3 = {'measurement': 'summary_site',
                            'tags': tags_3, 'fields': fields_3}
            data_summary_site.append(data_point_3)

    # setup database
    try:
        client = influxclient
        database_list = client.get_list_database()
        if any(database['name'] == 'carpark_data' for database in database_list):
            client.switch_database('carpark_data')
        else:
            client.create_database('carpark_data')
            client.switch_database('carpark_data')

        client.write_points(data_detail)
        client.write_points(data_summary_level)
        client.write_points(data_summary_site)
        time.sleep(1)
    except InfluxDBServerError:
        print('Error creating client')

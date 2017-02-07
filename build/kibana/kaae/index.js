/*
 * Copyright 2016, Lorenzo Mangani (lorenzo.mangani@gmail.com)
 * Copyright 2015, Rao Chenlin (rao.chenlin@gmail.com)
 *
 * This file is part of KaaE (http://github.com/elasticfence/kaae)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import _ from 'lodash';

export default function (kibana) {
  return new kibana.Plugin({
    require: ['kibana', 'elasticsearch'],

    uiExports: {
      spyModes: ['plugins/kaae/button/alarm_button'],
      // chromeNavControls: ['plugins/kaae/button/alarm_button'],
      app: {
        title: 'KaaE',
        description: 'Kibana Alert App for Elasticsearch',
        main: 'plugins/kaae/app',
        icon: 'plugins/kaae/kaae.svg'/*,
	injectVars: function (server, options) {
                               var config = server.config();
                               return {
                                   kbnIndex: config.get('kibana.index'),
                                   esShardTimeout: config.get('elasticsearch.shardTimeout'),
                                   esApiVersion: config.get('elasticsearch.apiVersion')
                               };
        }*/
      }
    },
    config: function (Joi) {
      return Joi.object({
        enabled: Joi.boolean().default(true),
      }).default();
    },
    init: require('./init.js')

  });
};

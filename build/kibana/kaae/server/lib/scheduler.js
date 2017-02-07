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
import later from 'later';
import doActions from './actions';

var Schedule = [];

function getCount(client) {
  return client.count({
    index:'watcher',
    type:"watch"
  });
}

function getWatcher(count,client) {
  return client.search({
    index:'watcher',
    type:"watch",
    size:count
  });
}

function doalert(server,client) {
  server.log(['status', 'debug', 'KaaE'], 'Reloading Watchers...');
  getCount(client).then(function(resp){
    getWatcher(resp.count,client).then(function(resp){
      /* Orphanizer */
        var orphans = _.difference(_.each(Object.keys( Schedule )), _.map(resp.hits.hits, '_id')  );
        _.each(orphans, function(orphan){
                server.log(['status', 'info', 'KaaE'],'Deleting orphan watcher: '+orphan);
                Schedule[orphan].later.clear();
                delete Schedule[orphan];
        });
        
      /* Scheduler */
      _.each(resp.hits.hits, function(hit){

        if (Schedule[hit._id]) {
          if (_.isEqual(Schedule[hit._id].hit, hit)) { return; }
          else { server.log(['status', 'info', 'KaaE'],'Clearing watcher: '+hit._id); Schedule[hit._id].later.clear(); }
        }

          Schedule[hit._id] = {};
          Schedule[hit._id].hit = hit;

          if(hit._source.trigger.schedule.later){
            // https://bunkat.github.io/later/parsers.html#text
            var interval = later.parse.text(hit._source.trigger.schedule.later);
            Schedule[hit._id].interval = hit._source.trigger.schedule.later;
          }
          else if(hit._source.trigger.schedule.interval % 1 === 0){
            // max 60 seconds!
            var interval = later.parse.recur().every(hit._source.trigger.schedule.interval).second();
            Schedule[hit._id].interval = hit._source.trigger.schedule.interval;
          }

          if (hit._source.report) {
            /* Report */
            Schedule[hit._id].later = later.setInterval(function(){ reporting(hit,interval) }, interval);
            server.log(['status', 'info', 'KaaE'], 'Scheduled Report: '+hit._id+' every '+Schedule[hit._id].interval );
          } else {
            /* Watcher */
            Schedule[hit._id].later = later.setInterval(function(){ watching(hit,interval) }, interval);
            server.log(['status', 'info', 'KaaE'], 'Scheduled Watch: '+hit._id+' every '+Schedule[hit._id].interval );
          }


          function watching(task,interval) {

			if (!task._source || task._source.disable) {
			server.log(['status', 'debug', 'KaaE'], 'Non-Executing Disabled Watch: '+task._id);
				return;
			}

				server.log(['status', 'info', 'KaaE'], 'Executing watch: '+task._id);
			server.log(['status', 'debug', 'KaaE', 'WATCHER DEBUG'], task);

				var watch = task._source;
				var request = watch.input.search.request;
				var condition = watch.condition.script.script;
				var transform = watch.transform ? watch.transform : {};
				var actions = watch.actions;

			if (JSON.stringify(request).indexOf('filterjoin') !== -1) {
			/* Kibi Join Query */
			client.coordinate_search(request).then(function(payload){
				  if (!payload || !condition || !actions) {
					server.log(['status', 'debug', 'KaaE', 'WATCHER TASK'], 'Join Watcher Malformed or Missing Key Parameters!');
					return;
				  }

				  server.log(['status', 'debug', 'KaaE', 'PAYLOAD DEBUG'], payload);

				  /* Validate Condition */
				  try { var ret = eval(condition); } catch (err) {
					  server.log(['status', 'info', 'KaaE'], 'Condition Error for '+task._id+': '+err);
				  }
				  if (ret) {
				  if (transform.script) {
					  try { eval(transform.script.script); } catch (err) {
					  server.log(['status', 'info', 'KaaE'], 'Transform Script Error for '+task._id+': '+err);
					  }
					  doActions(server,actions,payload);
				  } else if (transform.search) {
					  client.search(transform.search.request).then(function(payload) {
					  if (!payload) return;
					  doActions(server,actions,payload);
					  });
				  } else {
					  doActions(server,actions,payload);
				  }
				  }
				});
			} else {
			/* Normal ES Query */
			client.search(request).then(function(payload){
				  if (!payload || !condition || !actions) {
					server.log(['status', 'debug', 'KaaE', 'WATCHER TASK'], 'Watcher Malformed or Missing Key Parameters!');
					return;
				  }

				  server.log(['status', 'debug', 'KaaE', 'PAYLOAD DEBUG'], payload);

				  /* Validate Condition */
				  try { var ret = eval(condition); } catch (err) {
					  server.log(['status', 'info', 'KaaE'], 'Condition Error for '+task._id+': '+err);
				  }
				  if (ret) {
				  if (transform.script) {
					  try { eval(transform.script.script); } catch (err) {
					  server.log(['status', 'info', 'KaaE'], 'Transform Script Error for '+task._id+': '+err);
					  }
					  doActions(server,actions,payload);
				  } else if (transform.search) {
					  client.search(transform.search.request).then(function(payload) {
					  if (!payload) return;
					  doActions(server,actions,payload);
					  });
				  } else {
					  doActions(server,actions,payload);
				  }
				  }
				});
			}
        }
        function reporting(task,interval) {
	  if (!task._source || task._source.disable) {
		server.log(['status', 'debug', 'KaaE'], 'Non-Executing Disabled report: '+task._id);
          	return;
 	  }
          server.log(['status', 'info', 'KaaE'], 'Executing report: '+task._id );
          var actions = task._source.actions;
          var payload = { "_id": task._id };
          if (!actions) { server.log(['status', 'info', 'KaaE'], 'Condition Error for '+task._id); return; }
          doActions(server,actions,payload);
        }  
      });
    });
  });
}

module.exports = {
  doalert: doalert,
  getCount: getCount,
  getWatcher: getWatcher
};

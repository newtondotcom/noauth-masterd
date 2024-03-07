import express from 'express';
import cors from 'cors';
import Docker from 'dockerode';
import fs from 'fs';
import { CronJob } from 'cron';
import { exec } from 'child_process';
import fetch from 'node-fetch';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const app = express();
app.use(cors());
app.use(express.json());

app.listen(3000, () =>
  console.log('App listening on port 3000!')
);

const imageName = 'newtondotcom/noauthdiscord';

async function localRedeploy(bots) {
    try {
      await pullImage(imageName);
      const containers = await listContainers();
      for (const container of containers) {
        if (container.Image === imageName) {
          await stopContainer(container.Id);
          await removeContainer(container.Id);
          console.log(`Container ${container.Names[0]} stopped and removed.`);
        }
      }
  
      console.log('All existing containers stopped and removed.');
      for (const bot of bots) {
        await deploy1Container(bot);
      }
    } catch (error) {
      console.error('Error:', error.message);
      throw error; 
    }
  }

  async function deploy1Container(bot) {
    try {
      const Name = bot.container_name;
      const port = bot.port;
      const containerName = Name+"-"+port;

      
      const existingContainer = await getContainerByName(containerName);
      if (existingContainer) {
        await stopAndRemoveContainer(existingContainer.Id);
        console.log(`Existing container ${containerName} stopped and removed.`);
      } else
        console.log(`No existing container with name ${containerName}.`);

      
      const container = await createContainer(containerName, port);
      await startContainer(container.id);

      console.log(`Container ${containerName} started on port ${port}`);

      
      modifyGenerateConstants(Name);
      const tempFilePath = './generateConstants.js';
      console.log(`Modified generateConstants.js for ${containerName}`);
      await copyFileToContainer(container.id, tempFilePath, '/usr/src/bot/scripts/');        
      console.log(`Copied generateConstants.js to ${containerName}`);
      await restartContainer(container.id);
      console.log(`Container ${containerName} restarted`);
    } catch (error) {
      console.error('Error:', error.message);
      throw error; 
    }
  }

  async function updateList(bots) {
    try {
        // Remove containers that are not in the list
        const containerList = await listContainers();
        console.log('List of containers:', containerList);
        for (const container of containerList) {
          const botName = container.Names[0].split("-")[0].replace('/', '');
          if (!bots.some(b => b.container_name === botName)) {
            await stopAndRemoveContainer(container.Id);
            console.log(`Container ${container.Names[0]} stopped and removed.`);
          } else {
            console.log(`Container ${container.Names[0]} not removed.`);
            bots = bots.filter(b => b.container_name !== botName);
          }
        }
        console.log('All containers not in the list stopped and removed.');
        // Deploy new containers
        for (const bot of bots) {
          await deploy1Container(bot);
        }
        console.log('All new containers deployed.');
    } catch (error) {
      console.error('Error updating:', error.message);
      throw error;
    }
  }

  async function updateImages() {
    try {
      await removeOldImages();
      await pullImage(imageName);
      const containers = await listContainers();
      for (const container of containers) {
        if (container.Image === imageName) {
          await stopContainer(container.Id);
          await removeContainer(container.Id);
          const containerName = container.Names[0].split("-")[0];
          const containerPort = container.Names[0].split("-")[1];
          await deploy1Container({ container_name: containerName , port: containerPort });
        }
      }
    } catch (error) {
      console.error('Error updating image:', error.message);
      throw error;
    }
  }
  
  function modifyGenerateConstants(containerName) {
    try {
      
      let content = fs.readFileSync('./generateConstantsTemp.js', 'utf8');
      
      const newContent = content.replace(/^let botname = .+;$/m, `let botname = '${containerName}';`);
      
      fs.writeFileSync('./generateConstants.js', newContent.toString());
    } catch (error) {
      console.error('Error modifying generateConstants.js:', error.message);
      throw error;
    }
  }
  
  async function copyFileToContainer(containerId, localPath, containerPath) {
    try {
      const container = docker.getContainer(containerId);
  
      await new Promise((resolve, reject) => {
        exec(`tar -czf ${localPath}.tar.gz ${localPath}`, (error, stdout, stderr) => {
          if (error) {
            console.error(`Error creating tarball: ${error.message}`);
            reject(error);
          } else {
            console.log(`Tarball created: ${localPath}.tar.gz`);
            resolve();
          }
        });
      });
  
      
      await container.putArchive(`${localPath}.tar.gz`, { path: containerPath });
    } catch (error) {
      console.error('Error copying file to container:', error.message);
      throw error;
    }
  } 
  

async function pullImage(imageName) {
  return new Promise((resolve, reject) => {
    docker.pull(imageName, (err, stream) => {
      if (err) reject(err);
      else {
        docker.modem.followProgress(stream, onFinished, onProgress);

        function onFinished(err, output) {
          if (err) reject(err);
          else resolve(output);
        }

        function onProgress(event) {
          
        }
      }
    });
  });
}

async function listContainers() {
  return docker.listContainers();
}

async function stopContainer(containerId) {
  const container = docker.getContainer(containerId);
  return container.stop();
}

async function removeContainer(containerId) {
  const container = docker.getContainer(containerId);
  return container.remove();
}

async function createContainer(containerName, port) {
  return docker.createContainer({
    name: containerName,
    HostConfig: {
      PortBindings: {
        '5000/tcp': [{ HostPort: port }]
      }
    },
    Image: imageName
  });
}

async function startContainer(containerId) {
  const container = docker.getContainer(containerId);
  return container.start();
}

async function restartContainer(containerId) {
  const container = docker.getContainer(containerId);
  return container.restart();
}

async function getContainerByName(containerName) {
  const containers = await listContainers();
  return containers.find(c => c.Names[0].split("-")[0].includes(`${containerName}`));
}

async function stopAndRemoveContainer(containerId) {
  await stopContainer(containerId);
  await removeContainer(containerId);
}

async function removeOldImages() {
  const images = await docker.listImages();
  for (const image of images) {
    if (image.RepoTags && image.RepoTags[0] === imageName + ':latest') {
      await removeImage(image.Id);
    }
  }
}

app.post('/updateList', async (req, res) => {
  try {
    const bots = req.body.bots;
    //const bots = [{ container_name: 'test', port: '2000' }, { container_name: 'bashox', port: '2001' }];
    await updateList(bots);
    res.send('ok');
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(error.message);
  }
});

app.post('/add', async (req, res) => {
  try {
    const bot = req.body.bot;
    await deploy1Container(bot);
    res.send('ok');
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(error.message);
  }
});

app.post('/remove', async (req, res) => {
  try {
    const bot = req.body.bot;
    const botName = bot.container_name;
    const port = bot.port;
    const containerName = botName+"-"+port;
    const container = await getContainerByName(containerName);
    if (container) {
      await stopAndRemoveContainer(container.Id);
      console.log(`Container ${containerName} stopped and removed.`);
    }
    res.send('ok');
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(error.message);
  }
}


app.get('/updateImage', async (req, res) => {
  try {
    await updateImages();
    res.send('ok');
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(error.message);
  }
});

app.get('/health', (req, res) => {
  res.send('ok');
});

app.get('/test', async (req, res) => {
  try {
  await localRedeploy([{ container_name: 'test', port: '2000' }]);
  res.send('Testing done.');
  }
  catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(error.message);
  }
});

async function triggerSubscriptionsCheck(){
  try {
    let masterURL = "http://localhost:8000/check_subscriptions/";
    const response = await fetch(masterURL);
    const data = await response.json();
    console.log(data);
    if (data.status === "ok") {
      console.log("Subscriptions checked");
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

const job = new CronJob(
	'30 4 * * *', // cronTime: 4:30 AM every day
	function () {
    triggerSubscriptionsCheck();
	}, // onTick
	null, // onComplete
	false, // start
	'Europe/Paris' // timeZone
);
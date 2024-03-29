import express from 'express';
import cors from 'cors';
import Docker from 'dockerode';
import fs from 'fs';
import { CronJob } from 'cron';
import { exec } from 'child_process';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();


let header = {
  'Authorization': 'Api-Key ' + process.env.API_KEY
}

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const app = express();
app.use(cors());
app.use(express.json());

app.listen(3000, async () => {
  console.log('App listening on port 3000!');
  await pullImage(imageName);   
});

const imageName = 'newtondotcom/noauthdiscord';

async function localRedeploy(bots) {
    try {
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
      }

      modifyGenerateConstants(Name);
      const tempFilePath = './generateConstants.js';
      console.log(`Modified generateConstants.js for ${containerName}`);

      const container = await createContainer(containerName, port);
      await startContainer(container.id);

      console.log(`Container ${containerName} started on port ${port}`);
      await copyFileToContainer(container.id, tempFilePath, '/usr/src/bot/scripts/');        
      console.log(`Copied generateConstants.js to ${containerName}`);
      //await restartContainer(container.id);
      //console.log(`Container ${containerName} restarted`);
    } catch (error) {
      console.error('Error:', error.message);
      throw error; 
    }
  }

  async function updateImages() {
    try {
      const containers = await listContainers();
      for (const container of containers) {
        if (container.Image === imageName) {
          await stopContainer(container.Id);
          await removeContainer(container.Id);
          const containerName = container.Names[0].split("-")[0];
          const containerPort = container.Names[0].split("-")[1];
          await deploy1Container({ container_name: containerName , port: containerPort });
          console.log(`Container ${container.Names[0]} stopped, removed and redeployed.`);
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
          console.log('Image pulled:', imageName);
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
  for (const container of containers) {
    if (container.Names[0].includes(containerName)) {
      return container;
    }
  }
  console.log(`No container with name ${containerName} found.`);
  return null;
}

async function stopAndRemoveContainer(containerId) {
  await stopContainer(containerId);
  await removeContainer(containerId);
}

async function removeImage(imageId) {
  return docker.getImage(imageId).remove();
}

async function removeOldImages() {
  const images = await docker.listImages();
  for (const image of images) {
    if (image.RepoTags && image.RepoTags[0] === imageName + ':latest') {
      await removeImage(image.Id);
      console.log(`Image ${imageName} removed.`);
    }
  }
}

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
    } else {
      console.log(`No existing container with name ${containerName}.`);
    }
    res.send('ok');
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(error.message);
  }
});


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

app.get('/list', async (req, res) => {
  try {
    const containers = await listContainers();
    res.send(containers);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(error.message);
  }
});

app.get('/pull', async (req, res) => {
  try {
    await pullImage(imageName);
    res.send('Image repulled.');
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(error.message);
  }
});

async function triggerSubscriptionsCheck(){
  try {
    let masterURL = process.env.DJANGO_URL + "check_subscriptions/"
    console.log(masterURL);
    const response = await fetch(masterURL, {headers: header});
    const data = await response.text();
    console.log(data);
    if (data.status === "ok") {
      console.log("Subscriptions checked");
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

app.get('/checkSubscriptions', async (req, res) => {
  try {
    await triggerSubscriptionsCheck();
    res.send('All subscriptions checked.');
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(error.message);
  }
});

const job = new CronJob(
	'30 4 * * *', // cronTime: 4:30 AM every day
	function () {
    triggerSubscriptionsCheck();
	}, // onTick
	null, // onComplete
	true, // start
	'Europe/Paris' // timeZone
);

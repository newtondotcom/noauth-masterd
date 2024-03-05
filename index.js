import express from 'express';
import cors from 'cors';
import Docker from 'dockerode';
import fs from 'fs';
import { exec } from 'child_process';

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
      // Pull the latest image
      await pullImage(imageName);
  
      // Stop and remove existing containers of the same image
      const containers = await listContainers();
      for (const container of containers) {
        if (container.Image === imageName) {
          await stopContainer(container.Id);
          await removeContainer(container.Id);
          console.log(`Container ${container.Names[0]} stopped and removed.`);
        }
      }
  
      console.log('All existing containers stopped and removed.');
      
      // Create and start new containers
      for (const bot of bots) {
        const containerName = bot.container_name;
        const port = bot.port;
  
        // Check if a container with the same name already exists
        const existingContainer = await getContainerByName(containerName);
        if (existingContainer) {
          await stopAndRemoveContainer(existingContainer.Id);
          console.log(`Existing container ${containerName} stopped and removed.`);
        } else
          console.log(`No existing container with name ${containerName}.`);
  
        // Docker create command with port exposure
        const container = await createContainer(containerName, port);
        await startContainer(container.id);
  
        console.log(`Container ${containerName} started on port ${port}`);
  
        // Modify file within the running container
        modifyGenerateConstants(containerName);
        const tempFilePath = './generateConstants.js';
        console.log(`Modified generateConstants.js for ${containerName}`);
        await copyFileToContainer(container.id, tempFilePath, '/usr/src/bot/scripts/');        
        console.log(`Copied generateConstants.js to ${containerName}`);
        await restartContainer(container.id);
        console.log(`Container ${containerName} restarted`);
      }
    } catch (error) {
      console.error('Error:', error.message);
      throw error; // Propagate the error for handling in the caller function
    }
  }
  
  function modifyGenerateConstants(containerName) {
    try {
      // Read the contents of generateConstants.js from the local file system
      let content = fs.readFileSync('./generateConstantsTemp.js', 'utf8');
      // Modify the content
      const newContent = content.replace(/^let botname = .+;$/m, `let botname = '${containerName}';`);
      // Write the modified content to a temporary file
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
  
      // Put the tarball as an archive to the container
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
          // You can handle progress events here if needed
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
    name: containerName+Math.random().toString(36).substring(7),
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
  return containers.find(c => c.Names.includes(`/${containerName}`));
}

app.post('/update', async (req, res) => {
  try {
    const bots = req.body;
    await update(bots);
    res.send('ok');
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/health', (req, res) => {
  res.send('ok');
});

app.get('/test', async (req, res) => {
  await localRedeploy([{ container_name: 'test', port: '2000' }]);
  res.send('Test initiated.');
});

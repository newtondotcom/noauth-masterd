docker run -d \
  -p 3000:3000 \
  --name noauth \
  --restart=always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/lib/docker/volumes:/var/lib/docker/volumes \
  newtondotcom/noauthmasterd:latest
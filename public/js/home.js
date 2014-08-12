$(function(){


	var id = Number(window.location.pathname.match(/\/chat\/(\d+)$/)[1]);

	var name = "",
		friend = "";

	
	var section = $(".section"),
		onConnect = $(".connect"),
		inviteSomebody = $(".invite"),
		join = $(".join"),
		chatScreen = $(".chatscreen");
		

	var loginForm = $(".loginForm"),
        toggleHideShow = $("#hideShowMessages"),
		yourName = $("#yourName"),
		hisName = $("#hisName"),
		chatForm = $("#chatform"),
		textarea = $("#message"),
		submit = $("#submit"),
		chats = $(".chats");

    var local_media_stream = null;
	var signaling_socket = null;
	var peers = {};
    var peer_media_elements = {};
	var dataChannels = {};  
	var SIGNALING_SERVER = "";
	var USE_AUDIO = true;
    var USE_VIDEO = true;
    var MUTE_AUDIO_BY_DEFAULT = false;
	var sendChannel, receiveChannel;
   

	var ICE_SERVERS = [
                {url:"stun:stun.l.google.com:19302"}
            ];
	

    var color = "#" + ((1 << 24) * Math.random() | 0).toString(16);

  	var sdpConstraints = {'mandatory': {
  	'OfferToReceiveAudio':false,
  	'OfferToReceiveVideo':false }};


  ////////////////////////////////////////////////


    console.log("Connecting to signaling server");
    signaling_socket = io.connect(SIGNALING_SERVER);

    signaling_socket.on('connect', function() {
    	console.log("Connected to signaling server");
        signaling_socket.emit('load', id);
        setup_local_media(function() {
            signaling_socket.emit('join', {"channel": id});
        });      
   });
     

    signaling_socket.on('peopleinchat', function(data){

    	if(data.number === 1){

    		showMessage("connected");

    		loginForm.on('submit', function(e){

    			e.preventDefault();

    			name = $.trim(yourName.val());

    			showMessage("inviteSomebody");

    			signaling_socket.emit('login', {user: name, channel: id});
    		
    		});
    	}

    	else {

    		showMessage("personinchat",data);

    		loginForm.on('submit', function(e){
    			
    			e.preventDefault();
    			
    			name = $.trim(hisName.val());

    			signaling_socket.emit('login', {user: name, channel: id});
    			
    		});
    	}
    });
   
    signaling_socket.on('joined', function(data) {

    	createChatMessage("joined",data.users);
    	scrollToBottom();
    });

    signaling_socket.on('display', function() {
        $("video").css('display','inline');
    });
   
    signaling_socket.on('startChat', function(data){

    	if(data.boolean && data.id == id) {
    		
    		chats.empty();

    		if(name === data.users[0]) {

    			showMessage("youStartedChatWithNoMessages",data);
    		}
    		else {

    			showMessage("heStartedChatWithNoMessages",data);
    		}
            signaling_socket.emit('display',{channel : id});
    	}
    });

    textarea.keypress(function(e){

    	if(e.which == 13) {
    		e.preventDefault();
    		chatForm.trigger('submit');
    	}

    });

    chatForm.on('submit', function(e){

    	e.preventDefault();

    	showMessage("chatStarted");

    	createChatMessage(textarea.val(), name);

    	var data = textarea.val();
    	
    	textarea.val("");
    	for(peer_id in dataChannels) {
    		dataChannels[peer_id].send(JSON.stringify({"msg": data, "user" : name, "color" : color}));
    	}
    	
    });

    
    signaling_socket.on('disconnect', function() {
        console.log("Disconnected from signaling server");
        
        for (peer_id in peer_media_elements) {
            peer_media_elements[peer_id].remove();
        }
        for (peer_id in peers) {
            peers[peer_id].close();
        }

        peers = {};
        peer_media_elements = {};
    });
   
    toggleHideShow.click(function() {
      
      if(chats.css('display') === "block") {
        console.log("on");
        chats.css('display','none');
      }
      else {
        console.log("off");
        chats.css('display','block');
      }

    });
    
    signaling_socket.on('addPeer', function(config) {
        console.log('Signaling server said to add peer:', config);
        var peer_id = config.peer_id;
        if (peer_id in peers) {
            console.log("Already connected to peer ", peer_id);
            return;
        }
        var peer_connection = new RTCPeerConnection(
            {"iceServers": ICE_SERVERS},
            {"optional": [{"DtlsSrtpKeyAgreement": true}, {'RtpDataChannels': true}]}
        );
        peers[peer_id] = peer_connection;

        peer_connection.onicecandidate = function(event) {
            if (event.candidate) {
                signaling_socket.emit('relayICECandidate', {
                    'peer_id': peer_id, 
                    'ice_candidate': {
                        'sdpMLineIndex': event.candidate.sdpMLineIndex,
                        'candidate': event.candidate.candidate
                    }
                });
            }
        }
        peer_connection.onaddstream = function(event) {
            console.log("onAddStream", event);
            var remote_media = USE_VIDEO ? $("<video>") : $("<audio>");
            remote_media.attr("autoplay", "autoplay");
            if (MUTE_AUDIO_BY_DEFAULT) {
                remote_media.attr("muted", "true");
            }
            remote_media.attr("controls", "");
            peer_media_elements[peer_id] = remote_media;
            $('body').append(remote_media);
            scrollToBottom();
            attachMediaStream(remote_media[0], event.stream);
        }

       
        peer_connection.addStream(local_media_stream);
        


        if (config.should_create_offer) {

            sendChannel = peer_connection.createDataChannel("sendDataChannel", {reliable: false});

  			console.log("Created send channel" + dataChannels);

  			dataChannels[peer_id] = sendChannel;
  			sendChannel.onmessage = handleMessage;
			//sendChannel.onopen = handleSendChannelStateChange(peer_id);
			//sendChannel.onclose = handleSendChannelStateChange(peer_id);
		}

		else
		{
			console.log("Receive channel");
			peer_connection.ondatachannel = function(event) {
				trace('Receive Channel Callback');
				receiveChannel = event.channel;
				dataChannels[peer_id] = receiveChannel;
				receiveChannel.onmessage = handleMessage;
			}	
		} 

        if (config.should_create_offer) {

            console.log("Creating RTC offer to ", peer_id);
                peer_connection.createOffer(
                    function (local_description) { 
                        console.log("Local offer description is: ", local_description);
                        peer_connection.setLocalDescription(local_description, 
                        	function() { 
                                signaling_socket.emit('relaySessionDescription', 
                                        {'peer_id': peer_id, 'session_description': local_description});
                                console.log("Offer setLocalDescription succeeded"); 
                            },
                            function() { Alert("Offer setLocalDescription failed!"); }
                        );
                    },
                    function (error) {
                        console.log("Error sending offer: ", error);
                });

		}
        
    });
	
	

	//Handling the received chat msg

	function handleMessage(event) {
		trace('Received message: ' + event.data);
		var received = JSON.parse(event.data);
	
		showMessage('chatStarted');
		createChatMessage(received.msg, received.user, received.color);
	}


    signaling_socket.on('sessionDescription', function(config) {
        console.log('Remote description received: ', config);
        var peer_id = config.peer_id;
        var peer = peers[peer_id];
        var remote_description = config.session_description;
        console.log(config.session_description);

        var desc = new RTCSessionDescription(remote_description);
            var stuff = peer.setRemoteDescription(desc, 
            function() {
               console.log("setRemoteDescription succeeded");
                if (remote_description.type == "offer") {
                    console.log("Creating answer");
                    peer.createAnswer(
                        function(local_description) {
                            console.log("Answer description is: ", local_description);
                            peer.setLocalDescription(local_description,
                            function() { 
                                signaling_socket.emit('relaySessionDescription', 
                                    {'peer_id': peer_id, 'session_description': local_description});
                                console.log("Answer setLocalDescription succeeded");
                            },
                            function() { Alert("Answer setLocalDescription failed!"); }
                            );
                        },
                        function(error) {
                            console.log("Error creating answer: ", error);
                            console.log(peer);
                        });
                }
            },
           function(error) {
                console.log("setRemoteDescription error: ", error);
            }
            );
            console.log("Description Object: ", desc);

    });

           
    signaling_socket.on('iceCandidate', function(config) {
        var peer = peers[config.peer_id];
        var ice_candidate = config.ice_candidate;
        peer.addIceCandidate(new RTCIceCandidate(ice_candidate));
    });


    signaling_socket.on('removePeer', function(config) {
        console.log('Signaling server said to remove peer:', config);
        var peer_id = config.peer_id;
   		var userLeft = config.user;

   		createChatMessage("left", userLeft);
   		scrollToBottom();

        if (peer_id in peer_media_elements) {
            peer_media_elements[peer_id].remove();
        }

        if (peer_id in peers) {
            peers[peer_id].close();
        }

        delete peers[peer_id];
        delete peer_media_elements[config.peer_id];
    });

    function setup_local_media(callback, errorback) {
        if (local_media_stream != null) { 
            if (callback) callback();
            return; 
        }
       
        console.log("Requesting access to local audio / video inputs");
        getUserMedia({"audio":USE_AUDIO, "video":USE_VIDEO},
            function(stream) { 
                console.log("Access granted to audio/video");
                local_media_stream = stream;
                var local_media = USE_VIDEO ? $("<video>") : $("<audio>");
                local_media.attr("autoplay", "autoplay");
                local_media.attr("muted", "true"); 
                local_media.attr("controls", "");
                $('body').append(local_media);
                attachMediaStream(local_media[0], stream);
            
                if (callback) callback();
            },
            function() {
                console.log("Access denied for audio/video");
                alert("You chose not to provide access to the camera/microphone");
                if (errorback) errorback();
            });
    }


//////////////////////////////////////////////////////////////////////////////////////

	
	function createChatMessage(msg,user,color){

		var who = '';
		var li;

		if(msg === "joined" || msg === "left")
		{
			li = $( '<li class= msg >' + '<p style="color:#ff99ff;">' + '</p>' + '</li>' );
			li.find('p').text(user + " has " + msg + " this chat.");
		}

		else if(user===name && msg !== "joined" && msg !== "left") {
			who = 'me';
			li = $(
			'<li class=' + who + '>'+
			'<div>' +
			'<b style="color:#ff99ff;">' + '</b>' +
			'</div>' +
			'<p style="color:#ff99ff;">' + '</p>' +
			'</li>');
			li.find('b').text(user + ":");
			li.find('p').text(msg);
		}
		else {
			who = 'you';
			li = $(
			'<li class=' + who + '>' + 
			'<div>' +
			'<b style="color: ' + color + ';">' + '</b>' +
			'</div>' +
			'<p style="color: ' + color + ';">' + '</p>' + 
			'</li>');
			li.find('b').text(user + ":");
			li.find('p').text(msg);
		}

		chats.append(li);
	}

	function scrollToBottom(){
		$("html, body").animate({ scrollTop: $(document).height()-$(window).height() },1000);
	}

	function showMessage(status,data){

		if(status === "connected"){

			section.children().css('display', 'none');
			onConnect.fadeIn(1200);
		}

		else if(status === "inviteSomebody"){

			onConnect.fadeOut(1200, function(){
				inviteSomebody.fadeIn(1200);
			});
		}

		else if(status === "personinchat"){

			onConnect.css("display", "none");
			join.fadeIn(1200);
		
		}
		else if(status === "youStartedChatWithNoMessages") {

				inviteSomebody.fadeOut(1200,function(){
		          chatScreen.css('display','block');
				});

		}

		else if(status === "heStartedChatWithNoMessages") {

			join.fadeOut(1200,function(){
				 chatScreen.css('display','block');
			});
			
		}

		else if(status === "chatStarted"){

			//section.children().css('display','none');
			chatScreen.css('display','block');
		}

	}

});

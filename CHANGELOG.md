XXYX Changes made:                                                                                                                                                                                
                                                                                                                                                                                              
 1. Quicker refresh rate: Changed LOG_INTERVAL_MS from 500ms to 100ms                                                                                                                         
 2. Added average TPS tracking:                                                                                                                                                               
     - Added finalTPS field to store the final average when streaming ends                                                                                                                    
     - Added isStreaming flag to track state                                                                                                                                                  
     - Added SessionStats to track cumulative stats across messages                                                                                                                           
 3. Footer now persists:                                                                                                                                                                      
     - Removed the setTimeout that cleared metrics after 5 seconds in message_end                                                                                                             
     - Removed currentMetrics = null from the footer dispose handler                                                                                                                          
     - Footer now shows:                                                                                                                                                                      
           - ⚡ live t/s + time + tokens during streaming                                                                                                                                     
           - ⌀ avg t/s + time + tokens after streaming (stays fixed!)                                                                                                                         
           - ⌀ session avg t/s + message count as fallback                                                                                                                                    
 4. Session persistence:                                                                                                                                                                      
     - Stats accumulate across messages in the session                                                                                                                                        
     - Previous message stats are preserved when new streaming starts                                                                                                                         
     - Average is calculated as totalTokens / totalTimeSeconds
